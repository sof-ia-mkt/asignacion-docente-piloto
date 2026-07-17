// Token de sesión firmado (HMAC-SHA256). Formato: "<payloadB64url>.<firmaB64url>".
// El payload lleva el usuario y la expiración; la firma impide que alguien lo falsifique.
//
// Escrito SOLO con Web Crypto y btoa/atob (sin APIs de Node) a propósito: así el MISMO
// código corre tanto en el middleware (src/proxy.ts, runtime edge) como en el servidor
// (src/lib/session.ts, runtime node). El secreto vive en AUTH_SECRET.

// El secreto firma las sesiones. Es OBLIGATORIO en TODO entorno: un fallback conocido
// (aunque fuera "solo de desarrollo") permitiría falsificar una sesión de admin en cualquier
// despliegue donde NODE_ENV no sea exactamente 'production'. Genera uno con
// `openssl rand -hex 32` y ponlo en .env.local / variables de entorno (ver .env.example).
// Se resuelve de forma perezosa (al firmar/verificar, no al cargar el módulo) para no
// tronar el build, donde la variable puede no estar presente.
function getSecreto(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  throw new Error("AUTH_SECRET no está configurada. Es obligatoria para firmar las sesiones (openssl rand -hex 32).");
}

// `v` = versión de token del usuario (usuarios.token_version). Cambiar la contraseña
// incrementa la versión en la base → los tokens viejos dejan de coincidir y mueren.
// Es OPCIONAL y su ausencia vale 0: los tokens emitidos antes de este campo siguen
// siendo válidos (nadie se deslogueó al desplegarlo) hasta que su dueño cambie de contraseña.
type Payload = { u: string; exp: number; v?: number };

export type TokenLeido = { usuario: string; version: number };

// Comparación de tiempo constante (no corta en la primera diferencia): evita filtrar la
// firma por análisis de tiempos. Sin APIs de Node, para que corra también en el edge.
function igualdadSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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
    "raw", new TextEncoder().encode(getSecreto()),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return b64urlFromBytes(new Uint8Array(sig));
}

/** Crea un token firmado para `usuario` con su versión actual, válido `dias` días. */
export async function crearToken(usuario: string, version = 0, dias = 7): Promise<string> {
  const payload: Payload = { u: usuario, exp: Math.floor(Date.now() / 1000) + dias * 86400, v: version };
  const payloadB64 = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  return `${payloadB64}.${await firmar(payloadB64)}`;
}

/** Usuario y versión del token si la firma es válida y no expiró; null en cualquier otro caso.
 *  La comparación de versión contra la base la hace sesionActual() (aquí no hay BD: corre en edge). */
export async function leerToken(token: string | undefined): Promise<TokenLeido | null> {
  if (!token) return null;
  const punto = token.indexOf(".");
  if (punto < 0) return null;
  const payloadB64 = token.slice(0, punto);
  const firma = token.slice(punto + 1);
  if (!igualdadSegura(firma, await firmar(payloadB64))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(payloadB64))) as Payload;
    if (!payload.u || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { usuario: payload.u, version: typeof payload.v === "number" ? payload.v : 0 };
  } catch {
    return null;
  }
}
