"use server";
// Acciones de coordinación. Las de slot NO llaman a Claude (todo es BD, $0).
// crearDocente por CV SÍ llama a Claude una vez (~$0.05); por camino manual es $0.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, pool } from "@/lib/db";
import { leerCV } from "@/lib/cv";
import { esCoordinador } from "@/lib/ui";
import { recomputarAlertas } from "@/lib/alertas-core.mjs";
import { registrarCambio } from "@/lib/audit";
import {
  aplicarReversion,
  snapAsignacion, snapSlotAula, snapSlotHorario, snapAula, snapDocente, snapCandidatura,
} from "@/lib/revertir";

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

  // El CV se lee con Claude ANTES de abrir la transacción: es una llamada externa lenta
  // y no debe mantener tomada una conexión del pooler. Si falla, no se crea nada.
  let cv: Awaited<ReturnType<typeof leerCV>> | null = null;
  if (camino === "cv") {
    try {
      cv = await leerCV(pdf!, nombre);
    } catch (e) {
      return { error: `No se pudo leer el CV: ${e instanceof Error ? e.message : "error desconocido"}` };
    }
  }

  // Toda la escritura en UNA transacción: docente + competencias + candidaturas + alertas.
  // O se crea el docente completo y coherente, o no se crea nada (no quedan registros a medias).
  let profesorId: number;
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (cv) {
      const { rows: [prof] } = await client.query<{ id: number }>(
        `insert into profesores (nombre, slug, licenciatura, maestria, doctorado, area_cv, anios_experiencia, cv_archivo, coordinador)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [nombre, slug, cv.perfil.licenciatura || licenciatura, cv.perfil.maestria ?? maestria,
         doctorado, cv.perfil.area_principal ?? null, cv.perfil.anios_experiencia ?? anios, `${slug}.pdf`, coordinador]);
      profesorId = prof.id;
      await client.query(`insert into cv_competencias (profesor_id, payload, modelo) values ($1,$2,$3)`,
        [profesorId, cv.perfil, cv.modelo]);
      for (const c of cv.candidaturas) {
        await client.query(
          `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
           values ($1,$2,'cv',$3,$4)
           on conflict (profesor_id, materia_id, fuente) do nothing`,
          [profesorId, c.materia_id, c.puntaje, c.razon]);
      }
    } else {
      const { rows: [prof] } = await client.query<{ id: number }>(
        `insert into profesores (nombre, slug, licenciatura, maestria, doctorado, anios_experiencia, coordinador)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [nombre, slug, licenciatura, maestria, doctorado, anios, coordinador]);
      profesorId = prof.id;
      // Materias ya impartidas = señal más fuerte (+40), igual que el historial de mayo.
      for (const mid of materiaIds) {
        await client.query(
          `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
           values ($1,$2,'historial',40,'Marcado por coordinación: ya impartió esta materia')
           on conflict (profesor_id, materia_id, fuente) do nothing`,
          [profesorId, mid]);
      }
    }
    // Recálculo de alertas en la MISMA transacción: sus nuevas candidaturas pueden resolver
    // un "sin_candidato" existente. Una sola foto coherente del estado final.
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows));
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return { error: `No se pudo guardar el docente: ${e instanceof Error ? e.message : "error desconocido"}` };
  } finally {
    client.release();
  }

  await registrarCambio({
    entidad: "docente",
    entidadId: profesorId,
    accion: "creó",
    descripcion: `Dio de alta al docente "${nombre}" (${camino === "cv" ? "por CV" : "manual"}, coordinación ${coordinador})`,
    despues: { nombre, licenciatura, coordinador, camino },
  });

  revalidatePath("/profesores");
  revalidatePath("/alertas");
  revalidatePath("/");
  redirect(`/profesores/${profesorId}`);
}

// Asigna (o reasigna) un docente a un slot. Queda como decisión humana: confirmada, no automática.
//
// Reglas duras (candado de integridad, NO solo de UI):
//  1. Un docente no puede estar en dos clases a la misma hora. Si ya tiene otra clase de
//     septiembre encimada con el día/hora de ésta, se rechaza el empalme (sin excepción).
//  2. Una clase PRESENCIAL/síncrona sin horario no puede recibir docente: sin día/hora no
//     podríamos verificar el empalme. Las ASINCRÓNICAS (en línea, sin hora por diseño) sí
//     se pueden asignar: no ocupan un horario, así que no chocan con nada.
// La UI ya oculta el botón en estos casos; este candado protege ante pantallas viejas o
// llamadas directas. Lanza un error claro (en español) si se intenta violar la regla.
export async function asignar(slotId: number, profesorId: number, puntaje?: number, razon?: string) {
  const [s] = await q<{ modalidad: string | null; dia: string | null; hora_inicio: string | null; hora_fin: string | null }>(
    "select modalidad, dia, hora_inicio, hora_fin from slots where id=$1 and es_historial=false", [slotId]);
  if (!s) throw new Error("La clase no existe o no es del cuatrimestre a asignar.");
  const asincronica = (s.modalidad ?? "").toUpperCase().includes("ASINCR");
  const sinHorario = !s.dia || !s.hora_inicio || !s.hora_fin;
  if (sinHorario && !asincronica)
    throw new Error("Esta clase presencial aún no tiene horario. Captura el día y la hora antes de asignar un docente (así se evita empalmar al maestro).");
  if (!sinHorario) {
    const [choque] = await q<{ mat: string }>(
      `select coalesce(m2.nombre, 'otra clase') || coalesce(' · ' || g2.clave, '') mat
         from asignaciones a2
         join slots s2 on s2.id = a2.slot_id
         left join materias m2 on m2.id = s2.materia_id
         left join grupos g2 on g2.id = s2.grupo_id
        where a2.profesor_id = $1 and s2.es_historial = false and s2.id <> $2
          and s2.dia = $3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
        order by s2.hora_inicio limit 1`,
      [profesorId, slotId, s.dia, s.hora_inicio, s.hora_fin]);
    if (choque)
      throw new Error(`Ese docente ya da "${choque.mat}" a esa misma hora. No se puede empalmar: primero libéralo de esa clase o cambia el horario de alguna de las dos.`);
  }
  const antes = await snapAsignacion(slotId);   // foto del antes (para deshacer)
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
  const [info] = await q<{ materia: string | null; grupo: string | null; profesor: string | null }>(
    `select m.nombre materia, g.clave grupo, p.nombre profesor
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join profesores p on p.id = $2
      where s.id = $1`, [slotId, profesorId]);
  await registrarCambio({
    entidad: "asignacion",
    entidadId: slotId,
    accion: "asignó",
    descripcion: `Asignó a "${info?.profesor ?? "docente"}" en "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""}`,
    antes,
    despues: await snapAsignacion(slotId),
  });
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
  const antes = await snapAsignacion(slotId);   // foto del antes (estado previo)
  // Candado de integridad (no solo UI): no se puede "confirmar" una clase sin docente.
  const upd = await q<{ slot_id: number }>(
    "update asignaciones set estado='confirmada', automatica=false where slot_id=$1 and profesor_id is not null returning slot_id", [slotId]);
  if (upd.length) {
    const [info] = await q<{ materia: string | null; grupo: string | null; profesor: string | null }>(
      `select m.nombre materia, g.clave grupo, p.nombre profesor
         from slots s
         left join materias m on m.id = s.materia_id
         left join grupos g on g.id = s.grupo_id
         left join asignaciones a on a.slot_id = s.id
         left join profesores p on p.id = a.profesor_id
        where s.id = $1`, [slotId]);
    await registrarCambio({
      entidad: "asignacion",
      entidadId: slotId,
      accion: "confirmó",
      descripcion: `Confirmó la asignación de "${info?.profesor ?? "docente"}" en "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""}`,
      antes,
      despues: await snapAsignacion(slotId),
    });
  }
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
  const upd = await q<{ slot_id: number }>(
    `update asignaciones set estado = 'confirmada', automatica = false
      where estado = 'sugerida' and profesor_id is not null${scope} returning slot_id`, params);
  if (upd.length) {
    await registrarCambio({
      entidad: "asignacion",
      entidadId: null,
      accion: "confirmó",
      descripcion: `Confirmó en lote ${upd.length} sugerencia(s)${plantel ? ` en ${plantel}` : ""}`,
      despues: { n: upd.length, plantel: plantel ?? null },
    });
  }
  revalidatePath("/asignacion");
  revalidatePath("/");
}

// Asigna un aula al slot. Si ese salón queda ocupado a esa hora por otra clase,
// el recálculo levanta la alerta choque_aula (pero el aula se asigna igual: lo decide coordinación).
export async function asignarAula(slotId: number, aulaId: number) {
  const antes = await snapSlotAula(slotId);   // foto del aula previa (para deshacer)
  // aula_manual = true: el motor (asignar.mjs) ya no recalcula ni pisa este salón.
  await q("update slots set aula_id = $1, aula_manual = true where id = $2", [aulaId, slotId]);
  const [info] = await q<{ materia: string | null; grupo: string | null; aula: string | null }>(
    `select m.nombre materia, g.clave grupo, au.clave aula
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join aulas au on au.id = $2
      where s.id = $1`, [slotId, aulaId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "asignó",
    descripcion: `Asignó el aula "${info?.aula ?? "salón"}" a "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""}`,
    antes,
    despues: await snapSlotAula(slotId),
  });
  await recalcularAlertas();   // detecta choque_aula y quita sin_aula de este slot, sobre el estado actual
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Quita el aula del slot (lo deja sin salón). El recálculo limpia el choque y, si es presencial, levanta sin_aula.
export async function quitarAula(slotId: number) {
  const [info] = await q<{ materia: string | null; grupo: string | null; aula: string | null }>(
    `select m.nombre materia, g.clave grupo, au.clave aula
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join aulas au on au.id = s.aula_id
      where s.id = $1`, [slotId]);
  const antes = await snapSlotAula(slotId);   // foto del aula previa (para deshacer)
  await q("update slots set aula_id = null, aula_manual = false where id = $1", [slotId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "quitó",
    descripcion: `Quitó el aula${info?.aula ? ` "${info.aula}"` : ""} de "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""}`,
    antes,
    despues: await snapSlotAula(slotId),
  });
  await recalcularAlertas();
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Quita la asignación del slot (lo deja sin docente).
// profesorId es opcional: si viene (p. ej. al quitar desde la ficha del docente),
// también se refresca esa página para que la clase desaparezca de su lista al instante.
export async function quitarAsignacion(slotId: number, profesorId?: number) {
  const [info] = await q<{ materia: string | null; grupo: string | null; profesor: string | null }>(
    `select m.nombre materia, g.clave grupo, p.nombre profesor
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join asignaciones a on a.slot_id = s.id
       left join profesores p on p.id = a.profesor_id
      where s.id = $1`, [slotId]);
  const antes = await snapAsignacion(slotId);   // foto del docente previo (para deshacer)
  await q("update asignaciones set profesor_id=null, estado='rechazada', automatica=false where slot_id=$1", [slotId]);
  await registrarCambio({
    entidad: "asignacion",
    entidadId: slotId,
    accion: "quitó",
    descripcion: `Quitó a "${info?.profesor ?? "docente"}" de "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""}`,
    antes,
    despues: await snapAsignacion(slotId),
  });
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
  let nombreBorrado: string | null = null;
  // Foto COMPLETA del docente y sus datos ligados ANTES de borrar (decisión "foto completa":
  // hoy no se deshace un borrado, pero esto prepara la Fase 3 para poder recrearlo tal cual).
  let fotoBorrado: unknown = null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: [p] } = await client.query<Record<string, unknown>>(
      "select * from profesores where id=$1", [profesorId]);
    nombreBorrado = (p?.nombre as string) ?? null;
    const { rows: candidaturas } = await client.query("select * from materia_candidatos where profesor_id=$1", [profesorId]);
    const { rows: asignaciones } = await client.query("select * from asignaciones where profesor_id=$1", [profesorId]);
    const { rows: cv } = await client.query("select * from cv_competencias where profesor_id=$1", [profesorId]);
    const { rows: historial } = await client.query<{ id: number }>("select id from slots where docente_id=$1", [profesorId]);
    fotoBorrado = { docente: p ?? null, candidaturas, asignaciones, cv, historial_slot_ids: historial.map((h) => h.id) };
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
  await registrarCambio({
    entidad: "docente",
    entidadId: profesorId,
    accion: "borró",
    descripcion: `Eliminó al docente "${nombreBorrado ?? `#${profesorId}`}" (liberó sus clases de septiembre)`,
    antes: fotoBorrado,
  });
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
  const [aula] = await q<{ id: number }>(
    "insert into aulas (clave, tipo, capacidad) values ($1,$2,$3) returning id", [clave, tipo, cap.val]);
  await registrarCambio({
    entidad: "aula",
    entidadId: aula.id,
    accion: "creó",
    descripcion: `Dio de alta el salón "${clave}"${tipo ? ` (${tipo})` : ""}${cap.val != null ? ` · cupo ${cap.val}` : ""}`,
    despues: { clave, tipo, capacidad: cap.val },
  });
  revalidatePath("/aulas");
  return {};
}

// Edita tipo y capacidad de un salón existente (la clave es su identificador y no se cambia aquí).
// Capturar la capacidad faltante permite que el acomodo automático vuelva a considerar el salón.
export async function editarAula(aulaId: number, fd: FormData) {
  const tipo = String(fd.get("tipo") ?? "").trim() || null;
  const cap = parseCapacidad(String(fd.get("capacidad") ?? ""));
  const antes = await snapAula(aulaId);   // foto del tipo/cupo previos (para deshacer)
  await q("update aulas set tipo=$1, capacidad=$2 where id=$3",
    [tipo, cap.ok ? cap.val : null, aulaId]);
  const [a] = await q<{ clave: string }>("select clave from aulas where id=$1", [aulaId]);
  await registrarCambio({
    entidad: "aula",
    entidadId: aulaId,
    accion: "editó",
    descripcion: `Editó el salón "${a?.clave ?? `#${aulaId}`}"${tipo ? ` (${tipo})` : ""}${cap.ok && cap.val != null ? ` · cupo ${cap.val}` : ""}`,
    antes,
    despues: await snapAula(aulaId),
  });
  revalidatePath("/aulas");
}

// Borra un salón SOLO si ninguna clase de septiembre lo usa (si no, no hace nada: protege los datos).
export async function eliminarAula(aulaId: number) {
  const [u] = await q<{ n: number }>(
    "select count(*)::int n from slots where aula_id=$1 and es_historial=false", [aulaId]);
  if (u.n > 0) return;   // en uso: no se borra (la UI tampoco muestra el botón)
  // Foto COMPLETA del salón ANTES de borrar (prep Fase 3: recrear tal cual).
  const [a] = await q<Record<string, unknown>>("select * from aulas where id=$1", [aulaId]);
  await q("delete from aulas where id=$1", [aulaId]);
  await registrarCambio({
    entidad: "aula",
    entidadId: aulaId,
    accion: "borró",
    descripcion: `Eliminó el salón "${(a?.clave as string) ?? `#${aulaId}`}"`,
    antes: { aula: a ?? null },
  });
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

  const antes = await snapDocente(profesorId);   // foto de los datos previos (para deshacer)
  await q(
    `update profesores set nombre=$1, licenciatura=$2, maestria=$3, doctorado=$4, anios_experiencia=$5, coordinador=$6 where id=$7`,
    [nombre, licenciatura, maestria, doctorado, anios, coordinador, profesorId]);
  await registrarCambio({
    entidad: "docente",
    entidadId: profesorId,
    accion: "editó",
    descripcion: `Editó los datos del docente "${nombre}" (coordinación ${coordinador})`,
    antes,
    despues: await snapDocente(profesorId),
  });
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath("/profesores");
  redirect(`/profesores/${profesorId}`);
}

// Marca que el docente PUEDE dar una materia del catálogo (candidatura manual, +40 como el historial).
// Una candidatura nueva puede resolver un "sin_candidato", así que recalculamos alertas.
export async function agregarCandidatura(profesorId: number, fd: FormData) {
  const materiaNombre = String(fd.get("materia") ?? "").trim();
  if (!materiaNombre) return;
  const [m] = await q<{ id: number; nombre: string }>("select id, nombre from materias where lower(nombre)=lower($1)", [materiaNombre]);
  if (!m) return;   // sólo materias que ya existen en el catálogo
  const antes = await snapCandidatura(profesorId, m.id);   // foto del conjunto previo (para deshacer)
  const ins = await q<{ materia_id: number }>(
    `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
     values ($1,$2,'historial',40,'Agregado por coordinación: puede dar esta materia')
     on conflict (profesor_id, materia_id, fuente) do nothing returning materia_id`, [profesorId, m.id]);
  if (ins.length) {
    const [p] = await q<{ nombre: string }>("select nombre from profesores where id=$1", [profesorId]);
    await registrarCambio({
      entidad: "candidatura",
      entidadId: profesorId,
      accion: "agregó",
      descripcion: `Marcó que "${p?.nombre ?? "docente"}" puede dar "${m.nombre}"`,
      antes,
      despues: await snapCandidatura(profesorId, m.id),
    });
  }
  await recalcularAlertas();
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath(`/profesores/${profesorId}/editar`);
}

// Quita una materia de las que el docente puede dar (todas sus fuentes para esa materia).
// Si era el único candidato de esa materia, puede aparecer un "sin_candidato": recalculamos.
export async function quitarCandidatura(profesorId: number, materiaId: number) {
  const [ctx] = await q<{ profesor: string | null; materia: string | null }>(
    `select (select nombre from profesores where id=$1) profesor,
            (select nombre from materias where id=$2) materia`, [profesorId, materiaId]);
  const antes = await snapCandidatura(profesorId, materiaId);   // foto del conjunto previo (para deshacer)
  const del = await q<{ profesor_id: number }>(
    "delete from materia_candidatos where profesor_id=$1 and materia_id=$2 returning profesor_id", [profesorId, materiaId]);
  if (del.length) {
    await registrarCambio({
      entidad: "candidatura",
      entidadId: profesorId,
      accion: "quitó",
      descripcion: `Quitó "${ctx?.materia ?? "materia"}" de las que puede dar "${ctx?.profesor ?? "docente"}"`,
      antes,
      despues: await snapCandidatura(profesorId, materiaId),
    });
  }
  await recalcularAlertas();
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath(`/profesores/${profesorId}/editar`);
}

export type ProcesarCVState = { error?: string; ok?: string };

// Lee el CV (PDF) de un docente YA existente con Claude (~$0.05, una sola llamada) y:
//  1. SUMA las materias candidatas que deduzca (fuente 'cv'); on conflict do nothing → no duplica
//     ni borra lo que ya tiene (ni el historial +40 ni lo agregado a mano). No reasigna clases.
//  2. ACTUALIZA los datos del docente con lo extraído (licenciatura, maestría, área, experiencia),
//     conservando el valor previo si Claude no lo trae (coalesce).
//  3. Guarda el perfil crudo en cv_competencias (upsert: una fila por docente, para auditoría).
// Recalcula alertas al final: nuevas candidaturas pueden resolver un "sin_candidato".
export async function procesarCVDocente(profesorId: number, _prev: ProcesarCVState, fd: FormData): Promise<ProcesarCVState> {
  const [prof] = await q<{ id: number; nombre: string; slug: string }>(
    "select id, nombre, slug from profesores where id=$1", [profesorId]);
  if (!prof) return { error: "No se encontró el docente." };

  const file = fd.get("cv");
  if (!(file instanceof File) || file.size === 0) return { error: "Sube el archivo PDF del CV." };
  if (file.type !== "application/pdf") return { error: "El CV debe ser un archivo PDF." };
  const pdf = Buffer.from(await file.arrayBuffer());

  let res;
  try {
    res = await leerCV(pdf, prof.nombre);
  } catch (e) {
    return { error: `No se pudo leer el CV: ${e instanceof Error ? e.message : "error desconocido"}` };
  }

  // Actualiza los datos del docente con lo del CV (conserva lo previo si Claude no lo trae).
  await q(
    `update profesores set
       licenciatura      = coalesce(nullif($2,''), licenciatura),
       maestria          = coalesce(nullif($3,''), maestria),
       area_cv           = coalesce(nullif($4,''), area_cv),
       anios_experiencia = coalesce($5, anios_experiencia),
       cv_archivo        = $6
     where id = $1`,
    [profesorId, res.perfil.licenciatura ?? "", res.perfil.maestria ?? "",
     res.perfil.area_principal ?? "", res.perfil.anios_experiencia ?? null, `${prof.slug}.pdf`]);

  // Perfil crudo para auditoría (una fila por docente → upsert).
  await q(
    `insert into cv_competencias (profesor_id, payload, modelo) values ($1,$2,$3)
     on conflict (profesor_id) do update set payload = excluded.payload, modelo = excluded.modelo, creado_en = now()`,
    [profesorId, res.perfil, res.modelo]);

  // Suma materias candidatas. 'returning' con 'do nothing' solo devuelve las realmente insertadas.
  let nuevas = 0;
  for (const c of res.candidaturas) {
    const ins = await q(
      `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
       values ($1,$2,'cv',$3,$4)
       on conflict (profesor_id, materia_id, fuente) do nothing
       returning materia_id`,
      [profesorId, c.materia_id, c.puntaje, c.razon]);
    if (ins.length) nuevas++;
  }

  const total = res.candidaturas.length;
  await registrarCambio({
    entidad: "cv",
    entidadId: profesorId,
    accion: "procesó",
    descripcion: `Procesó el CV de "${prof.nombre}": ${total} materia(s) propuesta(s), ${nuevas} nueva(s)`,
    despues: { profesorId, propuestas: total, nuevas },
  });

  await recalcularAlertas();
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath(`/profesores/${profesorId}/editar`);
  revalidatePath("/profesores");
  revalidatePath("/alertas");
  revalidatePath("/");

  return {
    ok: `CV leído: Claude propuso ${total} materia(s); se agregaron ${nuevas} nueva(s)`
      + `${total - nuevas > 0 ? ` (${total - nuevas} ya las tenía)` : ""}. Sus datos se actualizaron.`,
  };
}

// ---------- Edición de la materia por grupo (lo que en datos llamamos "slot") ----------

const CICLO_SEPT = "2026-2027-1";   // ciclo a asignar (septiembre); el historial de mayo no se edita aquí
const limpiarHora = (h: string) => {
  const t = h.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;                 // hora fuera de rango
  // Siempre 'HH:MM' con cero a la izquierda: así la comparación textual de horarios
  // (detección de choques) coincide con el orden cronológico ("09:00" < "10:00").
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
};

// Edita día y horario de una materia por grupo. NO re-corre el motor (no reasigna docentes),
// pero sí recalcula las alertas: cambiar la hora puede crear o resolver choques y traslados.
export async function editarHorario(slotId: number, fd: FormData) {
  const dia = String(fd.get("dia") ?? "").trim() || null;
  const hi = limpiarHora(String(fd.get("hora_inicio") ?? ""));
  const hf = limpiarHora(String(fd.get("hora_fin") ?? ""));
  const antes = await snapSlotHorario(slotId);   // foto del horario previo (para deshacer)
  await q("update slots set dia=$1, hora_inicio=$2, hora_fin=$3 where id=$4 and es_historial=false",
    [dia, hi, hf, slotId]);
  const [info] = await q<{ materia: string | null; grupo: string | null }>(
    `select m.nombre materia, g.clave grupo from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id where s.id = $1`, [slotId]);
  const horarioTxt = dia && hi && hf ? `${dia} ${hi}-${hf}` : "sin horario";
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Editó el horario de "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""} → ${horarioTxt}`,
    antes,
    despues: await snapSlotHorario(slotId),
  });
  await recalcularAlertas();   // cambiar día/hora puede crear o resolver choques, traslados y choques de aula
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Elimina una materia por grupo (ej. "NO SE APERTURA"). Cascada borra su asignación y alertas.
export async function eliminarSlot(slotId: number) {
  // Recordamos a qué materia/grupo apuntaba ANTES de borrar la clase, para limpiar huérfanos.
  const [ref] = await q<{ materia_id: number | null; grupo_id: number | null; materia: string | null; grupo: string | null; plantel: string | null }>(
    `select s.materia_id, s.grupo_id, m.nombre materia, g.clave grupo, s.plantel
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
      where s.id=$1 and s.es_historial=false`, [slotId]);
  // Foto COMPLETA de la clase y su asignación ANTES de borrar (prep Fase 3: recrear tal cual).
  const [slotRow] = await q<Record<string, unknown>>("select * from slots where id=$1", [slotId]);
  const [asigRow] = await q<Record<string, unknown>>("select * from asignaciones where slot_id=$1", [slotId]);
  const fotoBorrado = { slot: slotRow ?? null, asignacion: asigRow ?? null };
  await q("delete from slots where id=$1 and es_historial=false", [slotId]);

  // Limpieza de huérfanos: si tras borrar la clase ya nadie usa la materia/grupo, los quitamos
  // para que no inflen el catálogo ni los conteos. Condiciones de seguridad:
  //  - Materia: borrar SOLO si NINGÚN slot la usa (incluye historial de mayo) Y no tiene
  //    candidaturas (materia_candidatos.materia_id es ON DELETE CASCADE: borrarla arrastraría
  //    el "este docente puede darla", dato que queremos conservar).
  //  - Grupo: borrar SOLO si NINGÚN slot lo usa.
  if (ref?.materia_id != null) {
    await q(
      `delete from materias m where m.id=$1
         and not exists (select 1 from slots s where s.materia_id=m.id)
         and not exists (select 1 from materia_candidatos mc where mc.materia_id=m.id)`,
      [ref.materia_id]);
  }
  if (ref?.grupo_id != null) {
    await q(
      `delete from grupos g where g.id=$1
         and not exists (select 1 from slots s where s.grupo_id=g.id)`,
      [ref.grupo_id]);
  }

  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "borró",
    descripcion: `Eliminó la clase "${ref?.materia ?? `#${slotId}`}"${ref?.grupo ? ` · ${ref.grupo}` : ""}${ref?.plantel ? ` (${ref.plantel})` : ""}`,
    antes: fotoBorrado,
  });
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

  await registrarCambio({
    entidad: "clase",
    entidadId: slot.id,
    accion: "creó",
    descripcion: `Creó la clase "${materiaNombre}"${grupoClave ? ` · ${grupoClave}` : ""} (${plantel})`,
    despues: { slotId: slot.id, materia: materiaNombre, grupo: grupoClave || null, plantel, tipo, modalidad },
  });
  await recalcularAlertas();   // una clase nueva nace sin docente y (si es presencial) sin aula: levanta sus alertas
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
  redirect(`/asignacion/${slot.id}`);
}

// ---------- Deshacer un movimiento del historial (Fase 2 de la bitácora) ----------

export type DeshacerState = { ok?: string; error?: string };

// Revierte el movimiento de bitácora indicado por el formulario (campo "id").
// El motor (revertir.ts) decide si es seguro: si el dato ya cambió desde entonces,
// BLOQUEA y devuelve un mensaje claro (no se pisa un cambio más reciente).
// Tras revertir, recalcula alertas (cambió el estado) y refresca las páginas afectadas.
export async function deshacerCambio(_prev: DeshacerState, fd: FormData): Promise<DeshacerState> {
  const id = Number(fd.get("id"));
  if (!Number.isFinite(id)) return { error: "Movimiento no válido." };

  const res = await aplicarReversion(id);
  if (!res.ok) return { error: res.error };

  // El estado pudo cambiar en cualquier entidad: rehacemos el diagnóstico y refrescamos todo
  // lo que pudo verse afectado (es barato y evita pantallas con foto vieja).
  await recalcularAlertas();
  revalidatePath("/historial");
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/aulas");
  revalidatePath("/profesores");
  revalidatePath("/");
  return { ok: `Se deshizo: ${res.descripcion}` };
}
