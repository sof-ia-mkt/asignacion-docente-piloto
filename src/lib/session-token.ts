// Token de sesión firmado (HMAC-SHA256). Formato: "<payloadB64url>.<firmaB64url>".
// El payload lleva el usuario y la expiración; la firma impide que alguien lo falsifique.
//
// Escrito SOLO con Web Crypto y btoa/atob (sin APIs de Node) a propósito: así el MISMO
// código corre tanto en el middleware (src/proxy.ts, runtime edge) como en el servidor
// (src/lib/session.ts, runtime node). El secreto vive en AUTH_SECRET.

const SECRETO = process.env.AUTH_SECRET || "cenyca-piloto-secreto-de-desarrollo";

type Payload = { u: string; exp: number };

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function firmar(payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRETO),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return b64urlFromBytes(new Uint8Array(sig));
}

/** Crea un token firmado para `usuario`, válido `dias` días. */
export async function crearToken(usuario: string, dias = 7): Promise<string> {
  const payload: Payload = { u: usuario, exp: Math.floor(Date.now() / 1000) + dias * 86400 };
  const payloadB64 = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  return `${payloadB64}.${await firmar(payloadB64)}`;
}

/** Devuelve el usuario del token si la firma es válida y no expiró; null en cualquier otro caso. */
export async function leerToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const punto = token.indexOf(".");
  if (punto < 0) return null;
  const payloadB64 = token.slice(0, punto);
  const firma = token.slice(punto + 1);
  if (firma !== (await firmar(payloadB64))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(payloadB64))) as Payload;
    if (!payload.u || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.u;
  } catch {
    return null;
  }
}
