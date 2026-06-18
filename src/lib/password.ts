// Cifrado de contraseñas con scrypt (incluido en Node, sin dependencias externas).
// Formato guardado: "scrypt:<saltHex>:<hashHex>". Nunca se guarda la contraseña en claro.
// SOLO servidor. El MISMO algoritmo y formato se replican en scripts/cargar_usuarios.mjs
// (la siembra inicial), así que cualquier cambio aquí hay que reflejarlo allá.
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const LARGO = 64;

export function cifrarPassword(plano: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plano, salt, LARGO);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verificarPassword(plano: string, guardado: string): boolean {
  const partes = guardado.split(":");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;
  const salt = Buffer.from(partes[1], "hex");
  const esperado = Buffer.from(partes[2], "hex");
  const calculado = scryptSync(plano, salt, esperado.length || LARGO);
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}
