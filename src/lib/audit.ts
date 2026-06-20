// Bitácora / historial de modificaciones — punto ÚNICO de registro (DRY).
// Cada acción de coordinación que cambia datos llama a registrarCambio(); así el
// "quién hizo qué y cuándo" vive en un solo lugar y nunca se duplica la lógica.
//
// Regla de oro: la bitácora JAMÁS debe tumbar la operación real. Si el registro
// falla (p. ej. la tabla aún no existe), se loguea y la acción del usuario sigue.
//
// SOLO servidor (escribe en la base vía db.ts).
import { q } from "./db";
import { nombreUsuarioActual } from "./usuario-actual";

// Qué entidad se tocó. Texto cerrado para que la pantalla pueda filtrar y etiquetar.
export type EntidadBitacora =
  | "docente"
  | "clase"
  | "aula"
  | "asignacion"
  | "candidatura"
  | "compactacion"   // Fase 2: juntar/separar grupos en una sola clase
  | "cv";

// Verbo de la acción, en lenguaje de coordinación.
export type AccionBitacora =
  | "creó"
  | "editó"
  | "borró"
  | "asignó"
  | "quitó"
  | "confirmó"
  | "envió"       // marcó la propuesta del docente como enviada por correo
  | "agregó"
  | "procesó"
  | "deshizo";   // Fase 2: revirtió un movimiento anterior (deja su propio rastro)

export type CambioBitacora = {
  entidad: EntidadBitacora;
  entidadId?: number | null;
  accion: AccionBitacora;
  descripcion: string;
  /** Foto opcional del antes/después (para auditoría y, en Fase 2, deshacer). */
  antes?: unknown;
  despues?: unknown;
  /** Quién lo hizo. Hoy anónimo ('Coordinación'); se podrá personalizar después. */
  actor?: string;
};

const ACTOR_POR_DEFECTO = "Coordinación";

/** Anota un cambio en la bitácora. Nunca lanza: si falla, lo registra en consola y sigue. */
export async function registrarCambio(c: CambioBitacora): Promise<void> {
  try {
    // Actor: el que se pase explícito; si no, la persona logueada; si no, el genérico.
    const actor = c.actor ?? (await nombreUsuarioActual()) ?? ACTOR_POR_DEFECTO;
    await q(
      `insert into bitacora (actor, entidad, entidad_id, accion, descripcion, datos_antes, datos_despues)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        actor,
        c.entidad,
        c.entidadId ?? null,
        c.accion,
        c.descripcion,
        c.antes != null ? JSON.stringify(c.antes) : null,
        c.despues != null ? JSON.stringify(c.despues) : null,
      ],
    );
  } catch (e) {
    console.error(
      "No se pudo registrar en la bitácora (la acción siguió su curso):",
      e instanceof Error ? e.message : e,
    );
  }
}
