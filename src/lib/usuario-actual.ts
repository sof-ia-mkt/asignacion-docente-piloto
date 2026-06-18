// Nombre de la persona logueada AHORA, para que la bitácora registre quién hizo qué.
// Lo toma de la sesión (cookie firmada). SOLO servidor. Devuelve null si no hay sesión
// identificable: el llamador (registrarCambio) cae al actor por defecto.
import { sesionActual } from "./session";

export async function nombreUsuarioActual(): Promise<string | null> {
  try {
    return (await sesionActual())?.nombre ?? null;
  } catch {
    return null;
  }
}
