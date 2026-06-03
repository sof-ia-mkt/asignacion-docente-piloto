"use server";
// Acciones de coordinación. Las de slot NO llaman a Claude (todo es BD, $0).
// crearDocente por CV SÍ llama a Claude una vez (~$0.05); por camino manual es $0.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, pool } from "@/lib/db";
import { leerCV } from "@/lib/cv";
import { esCoordinador } from "@/lib/ui";
import { recomputarAlertas } from "@/lib/alertas-core.mjs";

// Recalcula las alertas desde el ESTADO ACTUAL (diagnóstico; NO reasigna docentes ni aulas).
// Misma fuente de verdad que el motor (src/lib/alertas-core.mjs). Se llama tras cada edición
// para que el panel de alertas nunca quede como una foto vieja. Va en su propia transacción.
async function recalcularAlertas() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows));
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// Botón "Recalcular alertas" del panel: rehace el diagnóstico a mano, sin tocar asignaciones.
export async function recalcularAlertasManual() {
  await recalcularAlertas();
  revalidatePath("/alertas");
  revalidatePath("/");
}

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

export type CrearDocenteState = { error?: string };

// Alta de docente. Camino 'manual' = marca materias ya impartidas (+40). Camino 'cv' = Claude lee el PDF.
export async function crearDocente(_prev: CrearDocenteState, fd: FormData): Promise<CrearDocenteState> {
  const nombre = String(fd.get("nombre") ?? "").trim();
  const licenciatura = String(fd.get("licenciatura") ?? "").trim();
  const aniosRaw = String(fd.get("anios_experiencia") ?? "").trim();
  const maestria = String(fd.get("maestria") ?? "").trim() || null;
  const doctorado = String(fd.get("doctorado") ?? "").trim() || null;
  const coordinador = String(fd.get("coordinador") ?? "").trim();
  const camino = String(fd.get("camino") ?? "");

  if (!nombre || !licenciatura || !aniosRaw)
    return { error: "Faltan campos obligatorios: nombre, licenciatura y años de experiencia." };
  if (!coordinador) return { error: "Indica qué coordinador(a) académico lo va a asignar." };
  if (!esCoordinador(coordinador)) return { error: "Coordinador(a) no válido." };
  const anios = Number(aniosRaw);
  if (!Number.isFinite(anios) || anios < 0) return { error: "Años de experiencia debe ser un número válido." };
  if (camino !== "manual" && camino !== "cv") return { error: "Elige cómo definir sus materias: manual o por CV." };

  // Validar el contenido del camino ANTES de insertar (no dejar docentes a medias).
  const materiaIds = fd.getAll("materias").map((m) => Number(m)).filter((n) => Number.isFinite(n));
  let pdf: Buffer | null = null;
  if (camino === "manual") {
    if (materiaIds.length === 0) return { error: "Selecciona al menos una materia que ya haya impartido." };
  } else {
    const file = fd.get("cv");
    if (!(file instanceof File) || file.size === 0) return { error: "Sube el archivo PDF del CV." };
    if (file.type !== "application/pdf") return { error: "El CV debe ser un archivo PDF." };
    pdf = Buffer.from(await file.arrayBuffer());
  }

  // Evitar duplicados de nombre/slug.
  const slug = slugify(nombre);
  const dup = await q<{ id: number }>(
    "select id from profesores where lower(nombre)=lower($1) or slug=$2", [nombre, slug]);
  if (dup.length) return { error: `Ya existe un docente con ese nombre (o slug "${slug}").` };

  let profesorId: number;
  if (camino === "cv") {
    // Procesa el CV (1 llamada a Claude). Si falla, NO se crea el docente.
    let res;
    try {
      res = await leerCV(pdf!, nombre);
    } catch (e) {
      return { error: `No se pudo leer el CV: ${e instanceof Error ? e.message : "error desconocido"}` };
    }
    const [prof] = await q<{ id: number }>(
      `insert into profesores (nombre, slug, licenciatura, maestria, doctorado, area_cv, anios_experiencia, cv_archivo, coordinador)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [nombre, slug, res.perfil.licenciatura || licenciatura, res.perfil.maestria ?? maestria,
       doctorado, res.perfil.area_principal ?? null, res.perfil.anios_experiencia ?? anios, `${slug}.pdf`, coordinador]);
    profesorId = prof.id;
    await q(`insert into cv_competencias (profesor_id, payload, modelo) values ($1,$2,$3)`,
      [profesorId, res.perfil, res.modelo]);
    for (const c of res.candidaturas) {
      await q(
        `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
         values ($1,$2,'cv',$3,$4)
         on conflict (profesor_id, materia_id, fuente) do nothing`,
        [profesorId, c.materia_id, c.puntaje, c.razon]);
    }
  } else {
    const [prof] = await q<{ id: number }>(
      `insert into profesores (nombre, slug, licenciatura, maestria, doctorado, anios_experiencia, coordinador)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [nombre, slug, licenciatura, maestria, doctorado, anios, coordinador]);
    profesorId = prof.id;
    // Materias ya impartidas = señal más fuerte (+40), igual que el historial de mayo.
    for (const mid of materiaIds) {
      await q(
        `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
         values ($1,$2,'historial',40,'Marcado por coordinación: ya impartió esta materia')
         on conflict (profesor_id, materia_id, fuente) do nothing`,
        [profesorId, mid]);
    }
  }

  await recalcularAlertas();   // sus nuevas candidaturas pueden resolver un "sin_candidato" existente
  revalidatePath("/profesores");
  revalidatePath("/alertas");
  revalidatePath("/");
  redirect(`/profesores/${profesorId}`);
}

// Asigna (o reasigna) un docente a un slot. Queda como decisión humana: confirmada, no automática.
export async function asignar(slotId: number, profesorId: number, puntaje?: number, razon?: string) {
  await q(
    `insert into asignaciones (slot_id, profesor_id, estado, puntaje, razon, automatica)
     values ($1,$2,'confirmada',$3,$4,false)
     on conflict (slot_id) do update
       set profesor_id = excluded.profesor_id,
           estado = 'confirmada',
           puntaje = excluded.puntaje,
           razon = excluded.razon,
           automatica = false`,
    [slotId, profesorId, puntaje ?? null, razon ?? null]);
  await recalcularAlertas();   // poner a un docente puede resolver un choque/sin_candidato o crear sobrecarga
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath(`/profesores/${profesorId}`);  // si se asignó desde su ficha, que se refleje al instante
  revalidatePath("/");
}

// Confirma la sugerencia automática tal cual (la "acepta" coordinación).
// Solo cambia el estado (sugerida→confirmada), no el docente, así que el diagnóstico no cambia.
export async function confirmar(slotId: number) {
  await q("update asignaciones set estado='confirmada', automatica=false where slot_id=$1", [slotId]);
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/");
}

// Confirma EN LOTE todas las sugerencias automáticas que aún no se revisan (estado 'sugerida',
// con docente), opcionalmente acotado a un plantel. Es la forma rápida de "aceptar lo que propuso
// el sistema" sin abrir clase por clase. No cambia el docente, sólo el estado → no toca las alertas.
export async function confirmarSugeridas(plantel?: string) {
  const params: unknown[] = [];
  let scope = "";
  if (plantel) {
    params.push(plantel);
    scope = ` and slot_id in (select id from slots where es_historial = false and plantel = $${params.length})`;
  }
  await q(
    `update asignaciones set estado = 'confirmada', automatica = false
      where estado = 'sugerida' and profesor_id is not null${scope}`, params);
  revalidatePath("/asignacion");
  revalidatePath("/");
}

// Asigna un aula al slot. Si ese salón queda ocupado a esa hora por otra clase,
// el recálculo levanta la alerta choque_aula (pero el aula se asigna igual: lo decide coordinación).
export async function asignarAula(slotId: number, aulaId: number) {
  // aula_manual = true: el motor (asignar.mjs) ya no recalcula ni pisa este salón.
  await q("update slots set aula_id = $1, aula_manual = true where id = $2", [aulaId, slotId]);
  await recalcularAlertas();   // detecta choque_aula y quita sin_aula de este slot, sobre el estado actual
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Quita el aula del slot (lo deja sin salón). El recálculo limpia el choque y, si es presencial, levanta sin_aula.
export async function quitarAula(slotId: number) {
  await q("update slots set aula_id = null, aula_manual = false where id = $1", [slotId]);
  await recalcularAlertas();
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Quita la asignación del slot (lo deja sin docente).
// profesorId es opcional: si viene (p. ej. al quitar desde la ficha del docente),
// también se refresca esa página para que la clase desaparezca de su lista al instante.
export async function quitarAsignacion(slotId: number, profesorId?: number) {
  await q("update asignaciones set profesor_id=null, estado='rechazada', automatica=false where slot_id=$1", [slotId]);
  await recalcularAlertas();   // la clase queda sin docente: puede aparecer choque/sin_candidato, o bajar una sobrecarga
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  if (profesorId) revalidatePath(`/profesores/${profesorId}`);
  revalidatePath("/");
}

// Borra un docente por completo. Antes de borrarlo:
//  - libera sus clases de septiembre (se borran sus asignaciones; el motor podrá reasignarlas),
//  - desliga su historial de mayo (slots quedan sin docente, no se pierden las clases),
//  - elimina sus alertas. cv_competencias y materia_candidatos caen por cascade.
// Todo en una transacción: o se hace completo, o no se hace.
export async function eliminarDocente(profesorId: number) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from asignaciones where profesor_id=$1", [profesorId]);
    await client.query("update slots set docente_id=null where docente_id=$1", [profesorId]);
    await client.query("delete from profesores where id=$1", [profesorId]); // cascade: cv + candidatos
    // Recalcula alertas dentro de la MISMA transacción: sus clases quedan libres (posible
    // sin_candidato/choque) y desaparece su sobrecarga. Una sola foto coherente del estado final.
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows));
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  revalidatePath("/profesores");
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
  redirect("/profesores");
}

// ---------- CRUD de aulas (catálogo de salones) ----------

export type CrearAulaState = { error?: string };

const parseCapacidad = (raw: string): { ok: true; val: number | null } | { ok: false } => {
  const t = raw.trim();
  if (!t) return { ok: true, val: null };          // sin capacidad: válido (pero el acomodo la ignorará)
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return { ok: false };
  return { ok: true, val: n };
};

// Da de alta un salón nuevo en el catálogo.
export async function crearAula(_prev: CrearAulaState, fd: FormData): Promise<CrearAulaState> {
  const clave = String(fd.get("clave") ?? "").trim();
  const tipo = String(fd.get("tipo") ?? "").trim() || null;
  const cap = parseCapacidad(String(fd.get("capacidad") ?? ""));
  if (!clave) return { error: "Escribe la clave o nombre del salón." };
  if (!cap.ok) return { error: "La capacidad debe ser un número entero mayor que 0 (o déjala vacía)." };
  const dup = await q<{ id: number }>("select id from aulas where lower(clave)=lower($1)", [clave]);
  if (dup.length) return { error: `Ya existe un salón con la clave "${clave}".` };
  await q("insert into aulas (clave, tipo, capacidad) values ($1,$2,$3)", [clave, tipo, cap.val]);
  revalidatePath("/aulas");
  return {};
}

// Edita tipo y capacidad de un salón existente (la clave es su identificador y no se cambia aquí).
// Capturar la capacidad faltante permite que el acomodo automático vuelva a considerar el salón.
export async function editarAula(aulaId: number, fd: FormData) {
  const tipo = String(fd.get("tipo") ?? "").trim() || null;
  const cap = parseCapacidad(String(fd.get("capacidad") ?? ""));
  await q("update aulas set tipo=$1, capacidad=$2 where id=$3",
    [tipo, cap.ok ? cap.val : null, aulaId]);
  revalidatePath("/aulas");
}

// Borra un salón SOLO si ninguna clase de septiembre lo usa (si no, no hace nada: protege los datos).
export async function eliminarAula(aulaId: number) {
  const [u] = await q<{ n: number }>(
    "select count(*)::int n from slots where aula_id=$1 and es_historial=false", [aulaId]);
  if (u.n > 0) return;   // en uso: no se borra (la UI tampoco muestra el botón)
  await q("delete from aulas where id=$1", [aulaId]);
  revalidatePath("/aulas");
}

// ---------- Edición del docente (datos básicos + materias que puede dar) ----------

export type EditarDocenteState = { error?: string };

// Edita los datos básicos del docente. No toca su CV ni sus candidaturas (eso se maneja aparte).
// El slug NO cambia: es el identificador estable (URLs, nombre del CV); sólo cambia lo que se muestra.
export async function editarDocente(
  profesorId: number, _prev: EditarDocenteState, fd: FormData,
): Promise<EditarDocenteState> {
  const nombre = String(fd.get("nombre") ?? "").trim();
  const licenciatura = String(fd.get("licenciatura") ?? "").trim();
  const aniosRaw = String(fd.get("anios_experiencia") ?? "").trim();
  const maestria = String(fd.get("maestria") ?? "").trim() || null;
  const doctorado = String(fd.get("doctorado") ?? "").trim() || null;
  const coordinador = String(fd.get("coordinador") ?? "").trim();

  if (!nombre || !licenciatura || !aniosRaw)
    return { error: "Faltan campos obligatorios: nombre, licenciatura y años de experiencia." };
  if (!coordinador) return { error: "Indica qué coordinador(a) académico lo va a asignar." };
  if (!esCoordinador(coordinador)) return { error: "Coordinador(a) no válido." };
  const anios = Number(aniosRaw);
  if (!Number.isFinite(anios) || anios < 0) return { error: "Años de experiencia debe ser un número válido." };

  const dup = await q<{ id: number }>(
    "select id from profesores where lower(nombre)=lower($1) and id<>$2", [nombre, profesorId]);
  if (dup.length) return { error: "Ya existe otro docente con ese nombre." };

  await q(
    `update profesores set nombre=$1, licenciatura=$2, maestria=$3, doctorado=$4, anios_experiencia=$5, coordinador=$6 where id=$7`,
    [nombre, licenciatura, maestria, doctorado, anios, coordinador, profesorId]);
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath("/profesores");
  redirect(`/profesores/${profesorId}`);
}

// Marca que el docente PUEDE dar una materia del catálogo (candidatura manual, +40 como el historial).
// Una candidatura nueva puede resolver un "sin_candidato", así que recalculamos alertas.
export async function agregarCandidatura(profesorId: number, fd: FormData) {
  const materiaNombre = String(fd.get("materia") ?? "").trim();
  if (!materiaNombre) return;
  const [m] = await q<{ id: number }>("select id from materias where lower(nombre)=lower($1)", [materiaNombre]);
  if (!m) return;   // sólo materias que ya existen en el catálogo
  await q(
    `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
     values ($1,$2,'historial',40,'Agregado por coordinación: puede dar esta materia')
     on conflict (profesor_id, materia_id, fuente) do nothing`, [profesorId, m.id]);
  await recalcularAlertas();
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath(`/profesores/${profesorId}/editar`);
}

// Quita una materia de las que el docente puede dar (todas sus fuentes para esa materia).
// Si era el único candidato de esa materia, puede aparecer un "sin_candidato": recalculamos.
export async function quitarCandidatura(profesorId: number, materiaId: number) {
  await q("delete from materia_candidatos where profesor_id=$1 and materia_id=$2", [profesorId, materiaId]);
  await recalcularAlertas();
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath(`/profesores/${profesorId}/editar`);
}

// ---------- Edición de la materia por grupo (lo que en datos llamamos "slot") ----------

const CICLO_SEPT = "2026-2027-1";   // ciclo a asignar (septiembre); el historial de mayo no se edita aquí
const limpiarHora = (h: string) => {
  const t = h.trim();
  if (!t) return null;
  return /^\d{1,2}:\d{2}$/.test(t) ? t : null;   // 'HH:MM' o nada
};

// Edita día y horario de una materia por grupo. NO re-corre el motor (no reasigna docentes),
// pero sí recalcula las alertas: cambiar la hora puede crear o resolver choques y traslados.
export async function editarHorario(slotId: number, fd: FormData) {
  const dia = String(fd.get("dia") ?? "").trim() || null;
  const hi = limpiarHora(String(fd.get("hora_inicio") ?? ""));
  const hf = limpiarHora(String(fd.get("hora_fin") ?? ""));
  await q("update slots set dia=$1, hora_inicio=$2, hora_fin=$3 where id=$4 and es_historial=false",
    [dia, hi, hf, slotId]);
  await recalcularAlertas();   // cambiar día/hora puede crear o resolver choques, traslados y choques de aula
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Elimina una materia por grupo (ej. "NO SE APERTURA"). Cascada borra su asignación y alertas.
export async function eliminarSlot(slotId: number) {
  await q("delete from slots where id=$1 and es_historial=false", [slotId]);
  await recalcularAlertas();   // al desaparecer la clase, se recalcula el diagnóstico del resto
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
  redirect("/asignacion");
}

export type CrearSlotState = { error?: string };

// Crea una materia por grupo nueva en el ciclo de septiembre.
// La materia y el grupo se reutilizan si ya existen (por nombre/clave); si no, se crean.
export async function crearSlot(_prev: CrearSlotState, fd: FormData): Promise<CrearSlotState> {
  const plantel = String(fd.get("plantel") ?? "").trim();
  const materiaNombre = String(fd.get("materia") ?? "").trim();
  const grupoClave = String(fd.get("grupo") ?? "").trim();
  const tipo = String(fd.get("tipo") ?? "").trim() || null;
  const modalidad = String(fd.get("modalidad") ?? "").trim() || null;
  const dia = String(fd.get("dia") ?? "").trim() || null;
  const cuatrimestre = String(fd.get("cuatrimestre") ?? "").trim() || null;
  const hi = limpiarHora(String(fd.get("hora_inicio") ?? ""));
  const hf = limpiarHora(String(fd.get("hora_fin") ?? ""));

  if (!plantel) return { error: "Elige un plantel." };
  if (!materiaNombre) return { error: "Escribe el nombre de la materia." };

  // Materia: reutiliza por nombre (case-insensitive) o crea una nueva.
  let [materia] = await q<{ id: number }>(
    "select id from materias where lower(nombre)=lower($1)", [materiaNombre]);
  if (!materia) {
    [materia] = await q<{ id: number }>(
      "insert into materias (nombre, slug) values ($1,$2) returning id",
      [materiaNombre, slugify(materiaNombre)]);
  }

  // Grupo (opcional): reutiliza por clave o crea uno con solo la clave.
  let grupoId: number | null = null;
  if (grupoClave) {
    let [grupo] = await q<{ id: number }>("select id from grupos where clave=$1", [grupoClave]);
    if (!grupo) {
      [grupo] = await q<{ id: number }>(
        "insert into grupos (clave, cuatrimestre) values ($1,$2) returning id", [grupoClave, cuatrimestre]);
    }
    grupoId = grupo.id;
  }

  const [slot] = await q<{ id: number }>(
    `insert into slots (plantel, ciclo, es_historial, grupo_id, materia_id, cuatrimestre, tipo, modalidad, dia, hora_inicio, hora_fin)
     values ($1,$2,false,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [plantel, CICLO_SEPT, grupoId, materia.id, cuatrimestre, tipo, modalidad, dia, hi, hf]);

  await recalcularAlertas();   // una clase nueva nace sin docente y (si es presencial) sin aula: levanta sus alertas
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
  redirect(`/asignacion/${slot.id}`);
}
