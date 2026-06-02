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
  const area_cv = String(fd.get("area_cv") ?? "").trim();
  const aniosRaw = String(fd.get("anios_experiencia") ?? "").trim();
  const maestria = String(fd.get("maestria") ?? "").trim() || null;
  const camino = String(fd.get("camino") ?? "");

  if (!nombre || !licenciatura || !area_cv || !aniosRaw)
    return { error: "Faltan campos obligatorios: nombre, licenciatura, área y años de experiencia." };
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
      `insert into profesores (nombre, slug, licenciatura, maestria, area_cv, anios_experiencia, cv_archivo)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [nombre, slug, res.perfil.licenciatura || licenciatura, res.perfil.maestria ?? maestria,
       res.perfil.area_principal || area_cv, res.perfil.anios_experiencia ?? anios, `${slug}.pdf`]);
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
      `insert into profesores (nombre, slug, licenciatura, maestria, area_cv, anios_experiencia)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [nombre, slug, licenciatura, maestria, area_cv, anios]);
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

// Quita la asignación del slot (lo deja sin docente).
export async function quitarAsignacion(slotId: number) {
  await q("update asignaciones set profesor_id=null, estado='rechazada', automatica=false where slot_id=$1", [slotId]);
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/");
}
