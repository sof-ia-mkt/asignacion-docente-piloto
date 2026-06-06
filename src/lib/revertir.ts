// Motor de reversión — Fase 2 de la bitácora ("Deshacer").
// SOLO servidor (lee/escribe en la base vía db.ts).
//
// Idea: cada acción reversible guarda en la bitácora una FOTO estructurada del antes y del
// después (un "Snap"). Para deshacer, comparamos el estado ACTUAL contra la foto del "después":
//   - si coinciden → nadie tocó eso desde entonces → es seguro volver al "antes".
//   - si difieren  → alguien ya lo cambió → BLOQUEAMOS y avisamos (no pisamos su trabajo).
// La reversión vuelve a escribir la foto del "antes" y deja su propio rastro (acción "deshizo").
//
// El motor es GENÉRICO: no sabe de asignaciones ni aulas, solo aplica Snaps {tabla, clave, campos}.
// Así, agregar una acción reversible nueva = guardar su Snap; aquí no se toca nada.
import { q } from "./db";
import { registrarCambio, type EntidadBitacora } from "./audit";

// ---------- Tipos de foto ----------

// Una sola fila identificada por su clave. campos = valores a restaurar;
// campos === null significa "no debe existir fila" (p. ej. revertir un alta).
export type SnapRow = {
  kind: "row";
  tabla: string;
  clave: Record<string, unknown>;
  campos: Record<string, unknown> | null;
};

// Un conjunto de filas que comparten la misma clave (p. ej. todas las fuentes de una
// candidatura profesor↔materia). Al aplicar: se borra el conjunto y se reinserta tal cual.
export type SnapSet = {
  kind: "set";
  tabla: string;
  clave: Record<string, unknown>;
  filas: Array<Record<string, unknown>>;
};

export type Snap = SnapRow | SnapSet;

// ---------- Lectores de foto (usados al escribir Y para comparar al deshacer) ----------

export async function snapAsignacion(slotId: number): Promise<SnapRow> {
  const [r] = await q<{ profesor_id: number | null; estado: string; puntaje: number | null; razon: string | null; automatica: boolean }>(
    "select profesor_id, estado, puntaje, razon, automatica from asignaciones where slot_id=$1", [slotId]);
  return {
    kind: "row", tabla: "asignaciones", clave: { slot_id: slotId },
    campos: r ? { profesor_id: r.profesor_id, estado: r.estado, puntaje: r.puntaje, razon: r.razon, automatica: r.automatica } : null,
  };
}

export async function snapSlotAula(slotId: number): Promise<SnapRow> {
  const [r] = await q<{ aula_id: number | null; aula_manual: boolean }>(
    "select aula_id, aula_manual from slots where id=$1", [slotId]);
  return {
    kind: "row", tabla: "slots", clave: { id: slotId },
    campos: r ? { aula_id: r.aula_id, aula_manual: r.aula_manual } : null,
  };
}

export async function snapSlotHorario(slotId: number): Promise<SnapRow> {
  const [r] = await q<{ dia: string | null; hora_inicio: string | null; hora_fin: string | null }>(
    "select dia, hora_inicio, hora_fin from slots where id=$1", [slotId]);
  return {
    kind: "row", tabla: "slots", clave: { id: slotId },
    campos: r ? { dia: r.dia, hora_inicio: r.hora_inicio, hora_fin: r.hora_fin } : null,
  };
}

export async function snapAula(aulaId: number): Promise<SnapRow> {
  const [r] = await q<{ tipo: string | null; capacidad: number | null }>(
    "select tipo, capacidad from aulas where id=$1", [aulaId]);
  return {
    kind: "row", tabla: "aulas", clave: { id: aulaId },
    campos: r ? { tipo: r.tipo, capacidad: r.capacidad } : null,
  };
}

export async function snapDocente(profesorId: number): Promise<SnapRow> {
  const [r] = await q<{ nombre: string; licenciatura: string | null; maestria: string | null; doctorado: string | null; anios_experiencia: number | null; coordinador: string | null }>(
    "select nombre, licenciatura, maestria, doctorado, anios_experiencia, coordinador from profesores where id=$1", [profesorId]);
  return {
    kind: "row", tabla: "profesores", clave: { id: profesorId },
    campos: r ? { nombre: r.nombre, licenciatura: r.licenciatura, maestria: r.maestria, doctorado: r.doctorado, anios_experiencia: r.anios_experiencia, coordinador: r.coordinador } : null,
  };
}

export async function snapCandidatura(profesorId: number, materiaId: number): Promise<SnapSet> {
  const filas = await q<{ fuente: string; puntaje: number; razon: string | null }>(
    "select fuente, puntaje, razon from materia_candidatos where profesor_id=$1 and materia_id=$2 order by fuente", [profesorId, materiaId]);
  return {
    kind: "set", tabla: "materia_candidatos", clave: { profesor_id: profesorId, materia_id: materiaId },
    filas: filas.map((f) => ({ fuente: f.fuente, puntaje: f.puntaje, razon: f.razon })),
  };
}

// ---------- ¿Qué se puede deshacer? ----------

// Conjunto seguro (decisión "Solo lo seguro"): solo lo que tiene reversa clara y verificable.
// NO incluye altas, borrados, procesado de CV ni confirmaciones en lote (entidad_id null).
const REVERSIBLES: Record<string, Set<string>> = {
  asignacion: new Set(["asignó", "quitó", "confirmó"]),
  clase: new Set(["asignó", "quitó", "editó"]),
  aula: new Set(["editó"]),
  docente: new Set(["editó"]),
  candidatura: new Set(["agregó", "quitó"]),
};

// ¿Esta acción de bitácora es candidata a deshacer? (No mira la foto; solo el tipo de acción.)
export function esReversible(entidad: string, accion: string, entidadId: number | null): boolean {
  if (accion === "deshizo") return false;       // no se deshace un "deshacer" (se vuelve a hacer)
  if (entidadId == null) return false;          // sin objeto concreto (p. ej. lote) → no
  return REVERSIBLES[entidad]?.has(accion) ?? false;
}

// ---------- Motor genérico ----------

// Guarda contra inyección: los nombres de tabla/columna salen de Snaps que NOSOTROS generamos,
// pero como se interpolan en el SQL, los validamos igual (defensa en profundidad).
const ident = (s: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Identificador no permitido: ${s}`);
  return s;
};

// Igualdad tolerante: null/undefined se tratan igual; el resto se compara como texto
// (un int vuelve como número, en jsonb como número; coercer a String evita falsos choques).
const mismoValor = (a: unknown, b: unknown): boolean => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
};

const whereDe = (clave: Record<string, unknown>): { sql: string; params: unknown[] } => {
  const keys = Object.keys(clave);
  const sql = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(" and ");
  return { sql, params: keys.map((k) => clave[k]) };
};

// Lee el estado ACTUAL con la misma forma que un Snap esperado, para poder compararlos.
async function leerActual(esperado: Snap): Promise<Snap> {
  const w = whereDe(esperado.clave);
  if (esperado.kind === "row") {
    const cols = esperado.campos ? Object.keys(esperado.campos) : [];
    const sel = cols.length ? cols.map(ident).join(", ") : "1";
    const rows = await q<Record<string, unknown>>(
      `select ${sel} from ${ident(esperado.tabla)} where ${w.sql}`, w.params);
    const campos = rows.length
      ? (cols.length ? Object.fromEntries(cols.map((k) => [k, rows[0][k]])) : {})
      : null;
    return { kind: "row", tabla: esperado.tabla, clave: esperado.clave, campos };
  }
  // set
  const cols = esperado.filas[0] ? Object.keys(esperado.filas[0]) : ["fuente", "puntaje", "razon"];
  const filas = await q<Record<string, unknown>>(
    `select ${cols.map(ident).join(", ")} from ${ident(esperado.tabla)} where ${w.sql}`, w.params);
  return { kind: "set", tabla: esperado.tabla, clave: esperado.clave, filas };
}

// Firma canónica de una fila (claves ordenadas) para comparar conjuntos sin importar el orden.
const firma = (fila: Record<string, unknown>): string =>
  Object.keys(fila).sort().map((k) => `${k}=${fila[k] == null ? "∅" : String(fila[k])}`).join("|");

// ¿El estado actual coincide con la foto esperada? Si no, alguien lo cambió desde entonces.
function coincide(actual: Snap, esperado: Snap): boolean {
  if (actual.kind !== esperado.kind) return false;
  if (esperado.kind === "row" && actual.kind === "row") {
    if ((actual.campos === null) !== (esperado.campos === null)) return false;
    if (actual.campos === null || esperado.campos === null) return true;
    return Object.keys(esperado.campos).every((k) => mismoValor(actual.campos![k], esperado.campos![k]));
  }
  if (esperado.kind === "set" && actual.kind === "set") {
    const a = actual.filas.map(firma).sort();
    const b = esperado.filas.map(firma).sort();
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}

// Escribe la foto objetivo (el "antes" al deshacer).
async function aplicar(target: Snap): Promise<void> {
  const w = whereDe(target.clave);
  if (target.kind === "row") {
    if (target.campos === null) {
      await q(`delete from ${ident(target.tabla)} where ${w.sql}`, w.params);
      return;
    }
    // UPSERT manual: intenta UPDATE; si no había fila, INSERT (clave + campos).
    const cols = Object.keys(target.campos);
    const setSql = cols.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ");
    const setParams = cols.map((k) => target.campos![k]);
    const wParams2 = w.params.map((_, i) => `$${cols.length + i + 1}`);
    const wSql2 = Object.keys(target.clave).map((k, i) => `${ident(k)} = ${wParams2[i]}`).join(" and ");
    const upd = await q<{ ok: number }>(
      `update ${ident(target.tabla)} set ${setSql} where ${wSql2} returning 1 as ok`,
      [...setParams, ...w.params]);
    if (upd.length === 0) {
      const all = { ...target.clave, ...target.campos };
      const keys = Object.keys(all);
      await q(
        `insert into ${ident(target.tabla)} (${keys.map(ident).join(", ")})
         values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
        keys.map((k) => all[k]));
    }
    return;
  }
  // set: borra el conjunto y reinserta exactamente las filas guardadas.
  await q(`delete from ${ident(target.tabla)} where ${w.sql}`, w.params);
  for (const fila of target.filas) {
    const all = { ...target.clave, ...fila };
    const keys = Object.keys(all);
    await q(
      `insert into ${ident(target.tabla)} (${keys.map(ident).join(", ")})
       values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
      keys.map((k) => all[k]));
  }
}

// Valida que un valor leído de la bitácora sea una foto estructurada (y no un registro Fase 1).
function comoSnap(v: unknown): Snap | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "row" && typeof o.tabla === "string" && o.clave && typeof o.clave === "object") return o as unknown as SnapRow;
  if (o.kind === "set" && typeof o.tabla === "string" && Array.isArray(o.filas)) return o as unknown as SnapSet;
  return null;
}

export type ResultadoReversion = { ok: true; descripcion: string } | { ok: false; error: string };

// Deshace el movimiento de bitácora `id`. NO recalcula alertas ni revalida páginas:
// de eso se encarga la acción de servidor que la llama (deshacerCambio en actions.ts).
export async function aplicarReversion(id: number): Promise<ResultadoReversion> {
  const [row] = await q<{ entidad: string; entidad_id: number | null; accion: string; descripcion: string; datos_antes: unknown; datos_despues: unknown }>(
    "select entidad, entidad_id, accion, descripcion, datos_antes, datos_despues from bitacora where id=$1", [id]);
  if (!row) return { ok: false, error: "No se encontró ese movimiento en el historial." };
  if (!esReversible(row.entidad, row.accion, row.entidad_id))
    return { ok: false, error: "Este tipo de movimiento no se puede deshacer automáticamente." };

  const antes = comoSnap(row.datos_antes);
  const despues = comoSnap(row.datos_despues);
  if (!antes || !despues)
    return { ok: false, error: "Este movimiento es anterior a la función de deshacer (no guardó una foto para revertir)." };

  // Candado anti-conflicto: el estado actual debe seguir siendo el que dejó esta acción.
  const actual = await leerActual(despues);
  if (!coincide(actual, despues))
    return {
      ok: false,
      error: "No se pudo deshacer: ese dato ya cambió después de este movimiento. Revisa el estado actual antes de revertir, para no pisar un cambio más reciente.",
    };

  try {
    await aplicar(antes);
  } catch (e) {
    return { ok: false, error: `No se pudo deshacer: ${e instanceof Error ? e.message : "error desconocido"}` };
  }

  // Deja rastro del deshacer (e invierte las fotos: su "antes" es lo que había, su "después" lo restaurado).
  await registrarCambio({
    entidad: row.entidad as EntidadBitacora,
    entidadId: row.entidad_id,
    accion: "deshizo",
    descripcion: `Deshizo: ${row.descripcion}`,
    antes: despues,
    despues: antes,
  });
  return { ok: true, descripcion: row.descripcion };
}
