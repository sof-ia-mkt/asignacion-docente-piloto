"use server";
// Acciones de coordinación. Las de slot NO llaman a Claude (todo es BD, $0).
// crearDocente por CV SÍ llama a Claude una vez (~$0.05); por camino manual es $0.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { leerCV } from "@/lib/cv";

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
  const camino = String(fd.get("camino") ?? "");

  if (!nombre || !licenciatura || !aniosRaw)
    return { error: "Faltan campos obligatorios: nombre, licenciatura y años de experiencia." };
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
      `insert into profesores (nombre, slug, licenciatura, maestria, doctorado, area_cv, anios_experiencia, cv_archivo)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [nombre, slug, res.perfil.licenciatura || licenciatura, res.perfil.maestria ?? maestria,
       doctorado, res.perfil.area_principal ?? null, res.perfil.anios_experiencia ?? anios, `${slug}.pdf`]);
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
      `insert into profesores (nombre, slug, licenciatura, maestria, doctorado, anios_experiencia)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [nombre, slug, licenciatura, maestria, doctorado, anios]);
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

  revalidatePath("/profesores");
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
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/");
}

// Confirma la sugerencia automática tal cual (la "acepta" coordinación).
export async function confirmar(slotId: number) {
  await q("update asignaciones set estado='confirmada', automatica=false where slot_id=$1", [slotId]);
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/");
}

// Asigna un aula al slot. Si ese salón ya está ocupado a esa hora, levanta alerta de choque (pero asigna igual).
export async function asignarAula(slotId: number, aulaId: number) {
  // aula_manual = true: el motor (asignar.mjs) ya no recalcula ni pisa este salón.
  await q("update slots set aula_id = $1, aula_manual = true where id = $2", [aulaId, slotId]);
  const clash = await q<{ id: number; materia: string | null; grupo: string | null }>(
    `select s2.id, m.nombre materia, g.clave grupo
       from slots s2
       join slots s on s.id = $1
       left join materias m on m.id = s2.materia_id
       left join grupos g on g.id = s2.grupo_id
      where s2.es_historial = false and s2.aula_id = $2 and s2.id <> $1
        and s2.dia = s.dia and s2.hora_inicio < s.hora_fin and s.hora_inicio < s2.hora_fin`,
    [slotId, aulaId]);
  await q("delete from alertas where tipo = 'choque_aula' and slot_id = $1", [slotId]);
  if (clash.length) {
    const c = clash[0];
    const [au] = await q<{ clave: string }>("select clave from aulas where id = $1", [aulaId]);
    await q(
      `insert into alertas (tipo, severidad, slot_id, slot_id_2, detalle)
       values ('choque_aula','alta',$1,$2,$3)`,
      [slotId, c.id, `Aula ${au?.clave ?? ""} ya ocupada a esa hora por "${c.materia ?? "?"}" (${c.grupo ?? "?"}).`]);
  }
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Quita el aula del slot (lo deja sin salón) y limpia su alerta de choque.
export async function quitarAula(slotId: number) {
  await q("update slots set aula_id = null, aula_manual = false where id = $1", [slotId]);
  await q("delete from alertas where tipo = 'choque_aula' and slot_id = $1", [slotId]);
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Quita la asignación del slot (lo deja sin docente).
export async function quitarAsignacion(slotId: number) {
  await q("update asignaciones set profesor_id=null, estado='rechazada', automatica=false where slot_id=$1", [slotId]);
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/");
}

// ---------- Edición de la materia por grupo (lo que en datos llamamos "slot") ----------

const CICLO_SEPT = "2026-2027-1";   // ciclo a asignar (septiembre); el historial de mayo no se edita aquí
const limpiarHora = (h: string) => {
  const t = h.trim();
  if (!t) return null;
  return /^\d{1,2}:\d{2}$/.test(t) ? t : null;   // 'HH:MM' o nada
};

// Edita día y horario de una materia por grupo. (No re-corre el motor: las alertas son una foto.)
export async function editarHorario(slotId: number, fd: FormData) {
  const dia = String(fd.get("dia") ?? "").trim() || null;
  const hi = limpiarHora(String(fd.get("hora_inicio") ?? ""));
  const hf = limpiarHora(String(fd.get("hora_fin") ?? ""));
  await q("update slots set dia=$1, hora_inicio=$2, hora_fin=$3 where id=$4 and es_historial=false",
    [dia, hi, hf, slotId]);
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
}

// Elimina una materia por grupo (ej. "NO SE APERTURA"). Cascada borra su asignación y alertas.
export async function eliminarSlot(slotId: number) {
  await q("delete from slots where id=$1 and es_historial=false", [slotId]);
  revalidatePath("/asignacion");
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

  revalidatePath("/asignacion");
  revalidatePath("/");
  redirect(`/asignacion/${slot.id}`);
}
