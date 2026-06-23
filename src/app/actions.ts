"use server";
// Acciones de coordinación. Las de slot NO llaman a Claude (todo es BD, $0).
// crearDocente por CV SÍ llama a Claude una vez (~$0.05); por camino manual es $0.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { q, pool } from "@/lib/db";
import { cicloActivo, getCiclos } from "@/lib/ciclo";
import { leerCV } from "@/lib/cv";
import { nombresCoordinadores } from "@/lib/usuarios-db";
import { recomputarAlertas } from "@/lib/alertas-core.mjs";
import { registrarCambio } from "@/lib/audit";
import { exigirSesionActiva } from "@/lib/session";
import {
  aplicarReversion,
  snapAsignacion, snapAsignacionMulti, snapSlotAula, snapSlotHorario, snapSlotApertura, snapAula, snapDocente, snapCandidatura, snapPropuesta,
} from "@/lib/revertir";

// Recalcula las alertas desde el ESTADO ACTUAL (diagnóstico; NO reasigna docentes ni aulas).
// Misma fuente de verdad que el motor (src/lib/alertas-core.mjs). Se llama tras cada edición
// para que el panel de alertas nunca quede como una foto vieja. Va en su propia transacción.
async function recalcularAlertas() {
  const act = await cicloActivo();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows), act.id);
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
  await exigirSesionActiva();
  await recalcularAlertas();
  revalidatePath("/alertas");
  revalidatePath("/");
}

// Selector de ciclo del header: guarda en una cookie qué ciclo está viendo coordinación.
// Toda la app (queries, acciones, alertas) lee esa cookie vía cicloActivo(). Revalida en
// modo 'layout' para que TODAS las páginas se refresquen con el ciclo recién elegido.
export async function seleccionarCiclo(fd: FormData) {
  const codigo = String(fd.get("ciclo") ?? "").trim();
  const ciclos = await getCiclos();
  if (!ciclos.some((c) => c.codigo === codigo)) return;   // ignora valores que no existen
  const jar = await cookies();
  jar.set("ciclo", codigo, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

// Validación mínima de correo (no exhaustiva; solo evita capturas claramente mal formadas).
const esCorreoValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export type CrearDocenteState = { error?: string };

// Alta de docente. Camino 'manual' = marca materias ya impartidas (+40). Camino 'cv' = Claude lee el PDF.
export async function crearDocente(_prev: CrearDocenteState, fd: FormData): Promise<CrearDocenteState> {
  await exigirSesionActiva();
  const nombre = String(fd.get("nombre") ?? "").trim();
  const licenciatura = String(fd.get("licenciatura") ?? "").trim();
  const aniosRaw = String(fd.get("anios_experiencia") ?? "").trim();
  const maestria = String(fd.get("maestria") ?? "").trim() || null;
  const doctorado = String(fd.get("doctorado") ?? "").trim() || null;
  const coordinador = String(fd.get("coordinador") ?? "").trim();
  const correo = String(fd.get("correo") ?? "").trim() || null;
  const camino = String(fd.get("camino") ?? "");

  if (!nombre || !licenciatura || !aniosRaw)
    return { error: "Faltan campos obligatorios: nombre, licenciatura y años de experiencia." };
  if (!coordinador) return { error: "Indica qué coordinador(a) académico lo va a asignar." };
  if (!(await nombresCoordinadores()).includes(coordinador)) return { error: "Coordinador(a) no válido." };
  if (!correo) return { error: "El correo del docente es obligatorio: es a donde se le envía su propuesta." };
  if (!esCorreoValido(correo)) return { error: "El correo no tiene un formato válido (ej. nombre@dominio.com)." };
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
        `insert into profesores (nombre, slug, licenciatura, maestria, doctorado, area_cv, anios_experiencia, cv_archivo, coordinador, correo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [nombre, slug, cv.perfil.licenciatura || licenciatura, cv.perfil.maestria ?? maestria,
         doctorado, cv.perfil.area_principal ?? null, cv.perfil.anios_experiencia ?? anios, `${slug}.pdf`, coordinador, correo]);
      profesorId = prof.id;
      await client.query(`insert into cv_competencias (profesor_id, payload, modelo) values ($1,$2,$3)`,
        [profesorId, cv.perfil, cv.modelo]);
      for (const c of cv.candidaturas) {
        await client.query(
          `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
           values ($1,$2,'cv',$3,$4)
           on conflict (profesor_id, materia_id) do nothing`,
          [profesorId, c.materia_id, c.puntaje, c.razon]);
      }
    } else {
      const { rows: [prof] } = await client.query<{ id: number }>(
        `insert into profesores (nombre, slug, licenciatura, maestria, doctorado, anios_experiencia, coordinador, correo)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [nombre, slug, licenciatura, maestria, doctorado, anios, coordinador, correo]);
      profesorId = prof.id;
      // Materias ya impartidas = señal más fuerte (+40), igual que el historial de mayo.
      for (const mid of materiaIds) {
        await client.query(
          `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
           values ($1,$2,'historial',40,'Marcado por coordinación: ya impartió esta materia')
           on conflict (profesor_id, materia_id) do nothing`,
          [profesorId, mid]);
      }
    }
    // Recálculo de alertas en la MISMA transacción: sus nuevas candidaturas pueden resolver
    // un "sin_candidato" existente. Una sola foto coherente del estado final.
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows), (await cicloActivo()).id);
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
  await exigirSesionActiva();
  const act = await cicloActivo();
  const [s] = await q<{ modalidad: string | null; dia: string | null; hora_inicio: string | null; hora_fin: string | null; compactacion_id: number | null }>(
    `select modalidad, dia, hora_inicio, hora_fin, compactacion_id from slots where id=$1 and ciclo_id=${act.id}`, [slotId]);
  if (!s) throw new Error("La clase no existe o no es del cuatrimestre a asignar.");
  const asincronica = (s.modalidad ?? "").toUpperCase().includes("ASINCR");
  const sinHorario = !s.dia || !s.hora_inicio || !s.hora_fin;
  if (sinHorario && !asincronica)
    throw new Error("Esta clase presencial aún no tiene horario. Captura el día y la hora antes de asignar un docente (así se evita empalmar al maestro).");
  // Si la clase está COMPACTADA, el docente cubre TODOS sus grupos (es una sola clase):
  // asignamos a todos los slots miembros y el choque ignora a los hermanos (no chocan entre sí).
  const objetivos = s.compactacion_id
    ? (await q<{ id: number }>(`select id from slots where compactacion_id=$1 and ciclo_id=${act.id}`, [s.compactacion_id])).map((r) => r.id)
    : [slotId];
  if (!objetivos.includes(slotId)) objetivos.push(slotId);
  if (!sinHorario) {
    const [choque] = await q<{ mat: string }>(
      `select coalesce(m2.nombre, 'otra clase') || coalesce(' · ' || g2.clave, '') mat
         from asignaciones a2
         join slots s2 on s2.id = a2.slot_id
         left join materias m2 on m2.id = s2.materia_id
         left join grupos g2 on g2.id = s2.grupo_id
        where a2.profesor_id = $1 and s2.ciclo_id = ${act.id} and s2.id <> all($2)
          and s2.dia = $3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
        order by s2.hora_inicio limit 1`,
      [profesorId, objetivos, s.dia, s.hora_inicio, s.hora_fin]);
    if (choque)
      throw new Error(`Ese docente ya da "${choque.mat}" a esa misma hora. No se puede empalmar: primero libéralo de esa clase o cambia el horario de alguna de las dos.`);
  }
  const antes = await snapAsignacionMulti(objetivos);   // foto del antes (todos los grupos de la clase)
  await q(
    `insert into asignaciones (slot_id, profesor_id, estado, puntaje, razon, automatica)
     select unnest($1::int[]), $2, 'confirmada', $3, $4, false
     on conflict (slot_id) do update
       set profesor_id = excluded.profesor_id,
           estado = 'confirmada',
           puntaje = excluded.puntaje,
           razon = excluded.razon,
           automatica = false`,
    [objetivos, profesorId, puntaje ?? null, razon ?? null]);
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
    despues: await snapAsignacionMulti(objetivos),
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
export async function confirmar(slotId: number, profesorId?: number) {
  await exigirSesionActiva();
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
  if (profesorId) revalidatePath(`/profesores/${profesorId}`);
  revalidatePath("/");
}

// Confirma EN LOTE todas las sugerencias automáticas que aún no se revisan (estado 'sugerida',
// con docente), opcionalmente acotado a un plantel. Es la forma rápida de "aceptar lo que propuso
// el sistema" sin abrir clase por clase. No cambia el docente, sólo el estado → no toca las alertas.
// Confirma en lote SOLO las sugerencias que caen dentro de los filtros activos de la lista
// (plantel/cuatri/tipo/búsqueda). Así el botón nunca toca clases que el coordinador no está
// viendo: confirma exactamente lo que tiene en pantalla.
export async function confirmarSugeridas(
  filtro: { plantel?: string; cuatri?: string; tipo?: string; q?: string; plan?: string; turno?: string; modalidad?: string; comp?: string } = {},
) {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const conds: string[] = [`s.ciclo_id = ${act.id}`];
  const params: unknown[] = [];
  if (filtro.plantel) { params.push(filtro.plantel); conds.push(`s.plantel = $${params.length}`); }
  if (filtro.cuatri) { params.push(filtro.cuatri); conds.push(`s.cuatrimestre = $${params.length}`); }
  if (filtro.tipo) { params.push(filtro.tipo); conds.push(`s.tipo = $${params.length}`); }
  if (filtro.plan) { params.push(filtro.plan); conds.push(`g.plan_id in (select id from planes where nombre = $${params.length})`); }
  if (filtro.turno) { params.push(filtro.turno); conds.push(`split_part(g.clave, '_', 3) = $${params.length}`); }
  if (filtro.modalidad) { params.push(filtro.modalidad); conds.push(`s.modalidad = $${params.length}`); }
  if (filtro.comp === "si") conds.push("s.compactacion_id is not null");
  else if (filtro.comp === "no") conds.push("s.compactacion_id is null");
  if (filtro.q) { params.push(`%${filtro.q}%`); conds.push(`(m.nombre ilike $${params.length} or g.clave ilike $${params.length} or s.id_excel::text ilike $${params.length})`); }
  const sub = `select s.id from slots s
                 left join materias m on m.id = s.materia_id
                 left join grupos g on g.id = s.grupo_id
                where ${conds.join(" and ")}`;
  const upd = await q<{ slot_id: number }>(
    `update asignaciones set estado = 'confirmada', automatica = false
      where estado = 'sugerida' and profesor_id is not null and slot_id in (${sub}) returning slot_id`, params);
  if (upd.length) {
    const filtrosTxt = [
      filtro.plantel, filtro.cuatri && `cuatri ${filtro.cuatri}`, filtro.tipo,
      filtro.plan, filtro.turno && `turno ${filtro.turno}`, filtro.modalidad,
      filtro.comp === "si" ? "compactadas" : filtro.comp === "no" ? "sin compactar" : "",
      filtro.q && `"${filtro.q}"`,
    ].filter(Boolean).join(", ");
    await registrarCambio({
      entidad: "asignacion",
      entidadId: null,
      accion: "confirmó",
      descripcion: `Confirmó en lote ${upd.length} sugerencia(s)${filtrosTxt ? ` (${filtrosTxt})` : ""}`,
      despues: { n: upd.length, ...filtro },
    });
  }
  revalidatePath("/asignacion");
  revalidatePath("/");
}

// Asigna un aula al slot. Si ese salón queda ocupado a esa hora por otra clase,
// el recálculo levanta la alerta choque_aula (pero el aula se asigna igual: lo decide coordinación).
export async function asignarAula(slotId: number, aulaId: number) {
  await exigirSesionActiva();
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
  await exigirSesionActiva();
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
  await exigirSesionActiva();
  const [info] = await q<{ materia: string | null; grupo: string | null; profesor: string | null }>(
    `select m.nombre materia, g.clave grupo, p.nombre profesor
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join asignaciones a on a.slot_id = s.id
       left join profesores p on p.id = a.profesor_id
      where s.id = $1`, [slotId]);
  // Si la clase está compactada, quitar al docente lo libera de TODOS sus grupos (es una sola clase).
  const act = await cicloActivo();
  const [sc] = await q<{ compactacion_id: number | null }>(
    `select compactacion_id from slots where id=$1 and ciclo_id=${act.id}`, [slotId]);
  const objetivos = sc?.compactacion_id
    ? (await q<{ id: number }>(`select id from slots where compactacion_id=$1 and ciclo_id=${act.id}`, [sc.compactacion_id])).map((r) => r.id)
    : [slotId];
  const antes = await snapAsignacionMulti(objetivos);   // foto del docente previo de TODOS los grupos (para deshacer)
  // Borramos la fila para que la clase vuelva a estar libre y el motor pueda
  // proponer otro docente en la próxima corrida. (Antes la dejábamos como
  // 'rechazada'/automatica=false, lo que bloqueaba el slot para siempre.)
  await q("delete from asignaciones where slot_id = any($1)", [objetivos]);
  await registrarCambio({
    entidad: "asignacion",
    entidadId: slotId,
    accion: "quitó",
    descripcion: `Quitó a "${info?.profesor ?? "docente"}" de "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""}`,
    antes,
    despues: await snapAsignacionMulti(objetivos),
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
  await exigirSesionActiva();
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
      client.query(sql, params).then((r) => r.rows), (await cicloActivo()).id);
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
  await exigirSesionActiva();
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
  await exigirSesionActiva();
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
  await exigirSesionActiva();
  const act = await cicloActivo();
  const [u] = await q<{ n: number }>(
    `select count(*)::int n from slots where aula_id=$1 and ciclo_id=${act.id}`, [aulaId]);
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
  await exigirSesionActiva();
  const nombre = String(fd.get("nombre") ?? "").trim();
  const licenciatura = String(fd.get("licenciatura") ?? "").trim();
  const aniosRaw = String(fd.get("anios_experiencia") ?? "").trim();
  const maestria = String(fd.get("maestria") ?? "").trim() || null;
  const doctorado = String(fd.get("doctorado") ?? "").trim() || null;
  const coordinador = String(fd.get("coordinador") ?? "").trim();
  const correo = String(fd.get("correo") ?? "").trim() || null;

  if (!nombre || !licenciatura || !aniosRaw)
    return { error: "Faltan campos obligatorios: nombre, licenciatura y años de experiencia." };
  if (!coordinador) return { error: "Indica qué coordinador(a) académico lo va a asignar." };
  if (!(await nombresCoordinadores()).includes(coordinador)) return { error: "Coordinador(a) no válido." };
  if (correo && !esCorreoValido(correo)) return { error: "El correo no tiene un formato válido (ej. nombre@dominio.com)." };
  const anios = Number(aniosRaw);
  if (!Number.isFinite(anios) || anios < 0) return { error: "Años de experiencia debe ser un número válido." };

  const dup = await q<{ id: number }>(
    "select id from profesores where lower(nombre)=lower($1) and id<>$2", [nombre, profesorId]);
  if (dup.length) return { error: "Ya existe otro docente con ese nombre." };

  const antes = await snapDocente(profesorId);   // foto de los datos previos (para deshacer)
  await q(
    `update profesores set nombre=$1, licenciatura=$2, maestria=$3, doctorado=$4, anios_experiencia=$5, coordinador=$6, correo=$7 where id=$8`,
    [nombre, licenciatura, maestria, doctorado, anios, coordinador, correo, profesorId]);
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

// ---- Ciclo de vida de la PROPUESTA (por docente): borrador → enviada → confirmada ----
//
// La propuesta es UNA por docente (el PDF y el correo son del docente completo), así que el
// estado vive en `profesores`, no en cada asignación. Ambas transiciones son del coordinador
// y quedan en la bitácora con foto antes/después (reversibles desde /historial).

export type PropuestaResult = { ok: true } | { ok: false; error: string };

// "Enviar por correo" la dispara: al mandar el PDF, la propuesta queda como ENVIADA.
// Reenviar reinicia la confirmación (si ya estaba confirmada y se reenvía, vuelve a "enviada":
// es una propuesta nueva que el docente debe volver a aceptar).
export async function marcarPropuestaEnviada(profesorId: number): Promise<PropuestaResult> {
  await exigirSesionActiva();
  const [p] = await q<{ nombre: string; correo: string | null }>(
    "select nombre, correo from profesores where id=$1", [profesorId]);
  if (!p) return { ok: false, error: "No se encontró el docente." };
  if (!p.correo) return { ok: false, error: "El docente no tiene correo: no se puede registrar el envío de su propuesta." };

  const antes = await snapPropuesta(profesorId);
  await q(
    `update profesores set propuesta_estado='enviada', propuesta_enviada_en=now(), propuesta_confirmada_en=null where id=$1`,
    [profesorId]);
  await registrarCambio({
    entidad: "docente",
    entidadId: profesorId,
    accion: "envió",
    descripcion: `Envió la propuesta de "${p.nombre}" por correo (${p.correo})`,
    antes,
    despues: await snapPropuesta(profesorId),
  });
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath("/profesores");
  return { ok: true };
}

// "Confirmar propuesta": acto FORZOSO del coordinador. Candado de integridad (no solo UI):
// solo se puede confirmar una propuesta que ya fue ENVIADA. Nunca es automática.
export async function confirmarPropuesta(profesorId: number): Promise<PropuestaResult> {
  await exigirSesionActiva();
  const [p] = await q<{ nombre: string; propuesta_estado: string }>(
    "select nombre, propuesta_estado from profesores where id=$1", [profesorId]);
  if (!p) return { ok: false, error: "No se encontró el docente." };
  if (p.propuesta_estado !== "enviada")
    return { ok: false, error: "Solo se puede confirmar una propuesta que ya fue enviada al docente." };

  const antes = await snapPropuesta(profesorId);
  await q(
    `update profesores set propuesta_estado='confirmada', propuesta_confirmada_en=now() where id=$1`,
    [profesorId]);
  await registrarCambio({
    entidad: "docente",
    entidadId: profesorId,
    accion: "confirmó",
    descripcion: `Confirmó la propuesta de "${p.nombre}" (el docente la aceptó)`,
    antes,
    despues: await snapPropuesta(profesorId),
  });
  revalidatePath(`/profesores/${profesorId}`);
  revalidatePath("/profesores");
  return { ok: true };
}

// Marca que el docente PUEDE dar una materia del catálogo (candidatura manual, +40 como el historial).
// Una candidatura nueva puede resolver un "sin_candidato", así que recalculamos alertas.
export async function agregarCandidatura(profesorId: number, fd: FormData) {
  await exigirSesionActiva();
  const materiaNombre = String(fd.get("materia") ?? "").trim();
  if (!materiaNombre) return;
  const [m] = await q<{ id: number; nombre: string }>("select id, nombre from materias where lower(nombre)=lower($1)", [materiaNombre]);
  if (!m) return;   // sólo materias que ya existen en el catálogo
  const antes = await snapCandidatura(profesorId, m.id);   // foto del conjunto previo (para deshacer)
  const ins = await q<{ materia_id: number }>(
    `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
     values ($1,$2,'historial',40,'Agregado por coordinación: puede dar esta materia')
     on conflict (profesor_id, materia_id) do nothing returning materia_id`, [profesorId, m.id]);
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
  await exigirSesionActiva();
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
  await exigirSesionActiva();
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
       on conflict (profesor_id, materia_id) do nothing
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
  await exigirSesionActiva();
  const act = await cicloActivo();
  const dia = String(fd.get("dia") ?? "").trim() || null;
  let hi = limpiarHora(String(fd.get("hora_inicio") ?? ""));
  let hf = limpiarHora(String(fd.get("hora_fin") ?? ""));
  // Las horas van en par: la detección de choques compara inicio–fin como rango.
  // Una hora suelta (solo inicio o solo fin) no es un horario usable, así que la
  // descartamos antes de guardar para no dejar un horario a medias.
  if (!hi || !hf) { hi = null; hf = null; }
  const antes = await snapSlotHorario(slotId);   // foto del horario previo (para deshacer)
  await q(`update slots set dia=$1, hora_inicio=$2, hora_fin=$3 where id=$4 and ciclo_id=${act.id}`,
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

// Marca una clase como "No se apertura": se oculta de la lista de trabajo y de los conteos,
// el motor deja de asignarla y no genera alertas. NO borra nada: es reversible (Reactivar).
// A diferencia de eliminarSlot, conserva la asignación por si se reactiva más adelante.
export async function marcarNoApertura(slotId: number) {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const antes = await snapSlotApertura(slotId);
  const [info] = await q<{ materia: string | null; grupo: string | null }>(
    `select m.nombre materia, g.clave grupo from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id where s.id = $1`, [slotId]);
  await q(`update slots set no_apertura = true where id=$1 and ciclo_id=${act.id}`, [slotId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Marcó "${info?.materia ?? `clase #${slotId}`}"${info?.grupo ? ` · ${info.grupo}` : ""} como que NO se apertura (oculta, reversible)`,
    antes,
    despues: await snapSlotApertura(slotId),
  });
  await recalcularAlertas();   // al ocultar la clase, sus alertas (sin docente, etc.) ya no aplican
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
}

// Reactiva una clase que estaba como "No se apertura": vuelve a la lista de trabajo y al motor.
export async function reactivarSlot(slotId: number) {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const antes = await snapSlotApertura(slotId);
  const [info] = await q<{ materia: string | null; grupo: string | null }>(
    `select m.nombre materia, g.clave grupo from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id where s.id = $1`, [slotId]);
  await q(`update slots set no_apertura = false where id=$1 and ciclo_id=${act.id}`, [slotId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Reactivó "${info?.materia ?? `clase #${slotId}`}"${info?.grupo ? ` · ${info.grupo}` : ""} (vuelve a la lista a asignar)`,
    antes,
    despues: await snapSlotApertura(slotId),
  });
  await recalcularAlertas();   // al volver, puede recuperar sus alertas (sin docente, sin aula, etc.)
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
}

// Elimina una materia por grupo (ej. "NO SE APERTURA"). Cascada borra su asignación y alertas.
export async function eliminarSlot(slotId: number) {
  await exigirSesionActiva();
  const act = await cicloActivo();
  // Recordamos a qué materia/grupo apuntaba ANTES de borrar la clase, para limpiar huérfanos.
  const [ref] = await q<{ materia_id: number | null; grupo_id: number | null; materia: string | null; grupo: string | null; plantel: string | null }>(
    `select s.materia_id, s.grupo_id, m.nombre materia, g.clave grupo, s.plantel
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
      where s.id=$1 and s.ciclo_id=${act.id}`, [slotId]);
  // Foto COMPLETA de la clase y su asignación ANTES de borrar (prep Fase 3: recrear tal cual).
  const [slotRow] = await q<Record<string, unknown>>("select * from slots where id=$1", [slotId]);
  const [asigRow] = await q<Record<string, unknown>>("select * from asignaciones where slot_id=$1", [slotId]);
  const fotoBorrado = { slot: slotRow ?? null, asignacion: asigRow ?? null };
  await q(`delete from slots where id=$1 and ciclo_id=${act.id}`, [slotId]);

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

// Crea una materia por grupo nueva en el ciclo activo (el que está seleccionado en el header).
// La materia y el grupo se reutilizan si ya existen (por nombre/clave); si no, se crean.
export async function crearSlot(_prev: CrearSlotState, fd: FormData): Promise<CrearSlotState> {
  await exigirSesionActiva();
  const act = await cicloActivo();
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
    `insert into slots (plantel, ciclo, ciclo_id, es_historial, grupo_id, materia_id, cuatrimestre, tipo, modalidad, dia, hora_inicio, hora_fin)
     values ($1,$2,$3,false,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [plantel, act.codigo, act.id, grupoId, materia.id, cuatrimestre, tipo, modalidad, dia, hi, hf]);

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
  await exigirSesionActiva();
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

// ---------- Compactación de grupos (Fase 2: juntar / separar) ----------
// Compactar = ligar varios grupos de la MISMA materia y plantel en UNA sola clase
// (un docente, un aula, un horario). NO borra nada: crea un contenedor `compactaciones`
// y apunta los slots a él (slots.compactacion_id). Es 100% reversible con "separar".
// Todo el diagnóstico (choques, carga, repetido, aula) ya trata esos slots como UNA clase.

export type CompactarResult =
  | { ok: true; id: number }
  | { ok: false; error: string; needsConfirm?: "materia" };

export async function compactar(
  slotIds: number[],
  opts: {
    razon?: string;
    horario?: { dia: string; hora_inicio: string; hora_fin: string } | null;
    docenteId?: number | null;
    confirmarMateriaDistinta?: boolean;
  } = {},
): Promise<CompactarResult> {
  await exigirSesionActiva();
  const act = await cicloActivo();

  const ids = [...new Set((slotIds ?? []).filter((n) => Number.isFinite(n)))];
  if (ids.length < 2) return { ok: false, error: "Selecciona al menos 2 grupos para compactar en una sola clase." };

  // Trae los slots elegidos (solo del ciclo activo). Validamos TODO antes de escribir.
  const filas = await q<{
    id: number; materia_id: number | null; materia: string | null; plantel: string | null;
    dia: string | null; hora_inicio: string | null; hora_fin: string | null;
    compactacion_id: number | null; no_apertura: boolean; grupo: string | null; tipo: string | null;
  }>(
    `select s.id, s.materia_id, m.nombre materia, s.plantel, s.dia, s.hora_inicio, s.hora_fin,
            s.compactacion_id, s.no_apertura, g.clave grupo, s.tipo
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
      where s.id = any($1) and s.ciclo_id = ${act.id}`, [ids]);

  if (filas.length !== ids.length)
    return { ok: false, error: "Algún grupo seleccionado no existe en el cuatrimestre actual. Recarga la pantalla." };
  if (filas.some((f) => f.no_apertura))
    return { ok: false, error: "Hay un grupo marcado como “no se apertura”. Reactívalo o quítalo de la selección antes de compactar." };
  if (filas.some((f) => f.compactacion_id != null))
    return { ok: false, error: "Uno de los grupos ya está compactado. Sepáralo primero si quieres rehacer la compactación." };

  // CANDADO: misma sede (la compactación es DENTRO de un plantel; no se juntan sedes distintas).
  const planteles = [...new Set(filas.map((f) => f.plantel ?? ""))];
  if (planteles.length > 1)
    return { ok: false, error: "Solo se pueden compactar grupos del MISMO plantel (no se juntan clases de sedes distintas)." };

  // CANDADO: mismo tipo de slot (no se junta una clase DISCIPLINAR con un MÓDULO o VIRTUAL:
  // son piezas distintas del grupo, no la misma clase repetida).
  const tipos = [...new Set(filas.map((f) => (f.tipo ?? "").trim().toUpperCase()))];
  if (tipos.length > 1)
    return { ok: false, error: "Los grupos seleccionados son de distinto tipo de clase (Disciplinar / Módulo / Virtual). Solo se compacta la MISMA clase repetida en varios grupos." };

  // CANDADO: misma materia. Si difiere (típico por nombres sucios duplicados), pedimos confirmación.
  const materias = [...new Set(filas.map((f) => f.materia_id))];
  if (materias.length > 1 && !opts.confirmarMateriaDistinta)
    return {
      ok: false, needsConfirm: "materia",
      error: `Los grupos seleccionados tienen materias con distinto nombre (${[...new Set(filas.map((f) => f.materia))].filter(Boolean).join(" / ")}). ¿Seguro que es la misma clase? Confirma para compactar de todos modos.`,
    };
  const materiaId = filas[0].materia_id;
  const plantel = filas[0].plantel;

  // Resolver el horario COMPARTIDO: una clase = un horario.
  //  - Si todos ya coinciden, no se mueve nada.
  //  - Si difieren, el coordinador DEBE elegir uno (opts.horario) y se aplica a todos.
  const firmas = [...new Set(filas.map((f) => `${f.dia}|${f.hora_inicio}|${f.hora_fin}`))];
  let horarioAplicar: { dia: string; hi: string; hf: string } | null = null;
  if (opts.horario) {
    const dia = opts.horario.dia?.trim();
    const hi = limpiarHora(opts.horario.hora_inicio ?? "");
    const hf = limpiarHora(opts.horario.hora_fin ?? "");
    if (!dia || !hi || !hf)
      return { ok: false, error: "El horario elegido no es válido (día y hora inicio–fin en formato HH:MM)." };
    horarioAplicar = { dia, hi, hf };
  } else if (firmas.length > 1) {
    return { ok: false, error: "Los grupos están en horarios distintos. Elige a qué día y hora quedará la clase compactada." };
  }

  // Choque del docente (si se asigna desde aquí): no debe encimar con OTRAS clases suyas a esa hora.
  const docenteId = opts.docenteId ?? null;
  const efDia = horarioAplicar?.dia ?? filas[0].dia;
  const efHi = horarioAplicar?.hi ?? filas[0].hora_inicio;
  const efHf = horarioAplicar?.hf ?? filas[0].hora_fin;
  if (docenteId && efDia && efHi && efHf) {
    const [choque] = await q<{ mat: string }>(
      `select coalesce(m2.nombre,'otra clase') || coalesce(' · ' || g2.clave,'') mat
         from asignaciones a2 join slots s2 on s2.id=a2.slot_id
         left join materias m2 on m2.id=s2.materia_id
         left join grupos g2 on g2.id=s2.grupo_id
        where a2.profesor_id=$1 and s2.ciclo_id=${act.id} and s2.id <> all($2)
          and s2.dia=$3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
        order by s2.hora_inicio limit 1`,
      [docenteId, ids, efDia, efHi, efHf]);
    if (choque) return { ok: false, error: `El docente elegido ya da "${choque.mat}" a esa hora: no se puede asignar a la clase compactada sin empalmarlo.` };
  }

  // Escritura atómica: contenedor + ligar slots + (opcional) homogeneizar horario y asignar docente.
  let nuevoId: number;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: [comp] } = await client.query<{ id: number }>(
      `insert into compactaciones (ciclo_id, materia_id, plantel, razon) values ($1,$2,$3,$4) returning id`,
      [act.id, materiaId, plantel, opts.razon?.trim() || null]);
    nuevoId = comp.id;
    if (horarioAplicar)
      await client.query(`update slots set dia=$1, hora_inicio=$2, hora_fin=$3 where id = any($4)`,
        [horarioAplicar.dia, horarioAplicar.hi, horarioAplicar.hf, ids]);
    // TOCTOU: solo liga los slots que SIGUEN libres. Si alguno se compactó entremedias,
    // rowCount < ids.length y abortamos (rollback) en vez de robar slots de otra clase.
    const ligado = await client.query(
      `update slots set compactacion_id=$1 where id = any($2) and compactacion_id is null`, [nuevoId, ids]);
    if (ligado.rowCount !== ids.length)
      throw new Error("Uno de los grupos fue compactado por otra operación. Recarga e inténtalo de nuevo.");
    if (docenteId)
      await client.query(
        `insert into asignaciones (slot_id, profesor_id, estado, puntaje, razon, automatica)
         select unnest($1::int[]), $2, 'confirmada', null, $3, false
         on conflict (slot_id) do update
           set profesor_id=excluded.profesor_id, estado='confirmada', puntaje=excluded.puntaje, razon=excluded.razon, automatica=false`,
        [ids, docenteId, opts.razon?.trim() || "Asignado en compactación"]);
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows), act.id);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return { ok: false, error: `No se pudo compactar: ${e instanceof Error ? e.message : "error desconocido"}` };
  } finally {
    client.release();
  }

  const grupos = filas.map((f) => f.grupo).filter(Boolean).join(", ");
  await registrarCambio({
    entidad: "compactacion",
    entidadId: nuevoId,
    accion: "creó",
    descripcion: `Compactó ${ids.length} grupos en una sola clase de "${filas[0].materia ?? "materia"}"${plantel ? ` (${plantel})` : ""}: ${grupos}${opts.razon?.trim() ? ` — ${opts.razon.trim()}` : ""}`,
    despues: { id: nuevoId, slotIds: ids, materiaId, plantel, razon: opts.razon?.trim() || null, docenteId },
  });

  revalidatePath("/compactacion");
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/historial");
  revalidatePath("/");
  return { ok: true, id: nuevoId };
}

// Separar = deshacer la compactación: los grupos vuelven a ser clases independientes.
// Solo DESLIGA (slots.compactacion_id = null) y borra el contenedor; el horario y el docente
// que tengan se conservan (cada grupo queda autónomo, como antes de juntarlos).
export async function separar(compactacionId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const [c] = await q<{ id: number; materia: string | null; plantel: string | null }>(
    `select c.id, m.nombre materia, c.plantel from compactaciones c left join materias m on m.id=c.materia_id where c.id=$1`, [compactacionId]);
  if (!c) return { ok: false, error: "Esa compactación ya no existe (quizá ya se separó)." };
  const miembros = await q<{ id: number; grupo: string | null }>(
    `select s.id, g.clave grupo from slots s left join grupos g on g.id=s.grupo_id where s.compactacion_id=$1`, [compactacionId]);

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`update slots set compactacion_id=null where compactacion_id=$1`, [compactacionId]);
    await client.query(`delete from compactaciones where id=$1`, [compactacionId]);
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows), act.id);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return { ok: false, error: `No se pudo separar: ${e instanceof Error ? e.message : "error desconocido"}` };
  } finally {
    client.release();
  }

  await registrarCambio({
    entidad: "compactacion",
    entidadId: compactacionId,
    accion: "borró",
    descripcion: `Separó la clase compactada de "${c.materia ?? "materia"}"${c.plantel ? ` (${c.plantel})` : ""}: ${miembros.map((m) => m.grupo).filter(Boolean).join(", ")} vuelven a ser grupos independientes`,
    antes: { id: compactacionId, slotIds: miembros.map((m) => m.id) },
  });

  revalidatePath("/compactacion");
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/historial");
  revalidatePath("/");
  return { ok: true };
}

// Marca (o desmarca) un grupo como "reducido": pista MANUAL del coordinador, independiente del
// número de alumnos (que muchas veces no se captura). No condiciona nada; solo informa en la pantalla.
export async function marcarChico(grupoId: number, valor: boolean) {
  await exigirSesionActiva();
  const [g] = await q<{ clave: string; es_chico: boolean }>("select clave, es_chico from grupos where id=$1", [grupoId]);
  if (!g) return;
  if (g.es_chico === valor) return;   // sin cambio real
  await q("update grupos set es_chico=$1 where id=$2", [valor, grupoId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: grupoId,
    accion: "editó",
    descripcion: `${valor ? "Marcó" : "Quitó la marca de"} “grupo reducido” en ${g.clave}`,
    antes: { es_chico: g.es_chico },
    despues: { es_chico: valor },
  });
  revalidatePath("/compactacion");
}

// Captura/edita el número de alumnos de un grupo desde Compactación. OJO: el dato vive en
// la tabla `grupos`, así que afecta a TODOS los slots del grupo y a las pantallas que lo usan
// (recomendación de aula, alerta "ningún salón alcanza", motor de asignación, dashboard de aulas).
// Es reversible por naturaleza: siempre se puede volver a editar. `valor` null = lo deja en blanco.
export async function editarAlumnosGrupo(
  grupoId: number, valor: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await exigirSesionActiva();
  let nuevo: number | null = valor;
  if (nuevo != null) {
    if (!Number.isFinite(nuevo) || !Number.isInteger(nuevo) || nuevo < 0)
      return { ok: false, error: "El número de alumnos debe ser un entero de 0 o más." };
    if (nuevo > 1000)
      return { ok: false, error: "Ese número de alumnos parece demasiado alto (máx. 1000)." };
  }
  const [g] = await q<{ clave: string; alumnos: number | null }>(
    "select clave, alumnos from grupos where id=$1", [grupoId]);
  if (!g) return { ok: false, error: "Ese grupo ya no existe." };
  if ((g.alumnos ?? null) === nuevo) return { ok: true };   // sin cambio real
  await q("update grupos set alumnos=$1 where id=$2", [nuevo, grupoId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: grupoId,
    accion: "editó",
    descripcion: nuevo == null
      ? `Quitó el número de alumnos de ${g.clave}`
      : `Capturó ${nuevo} alumno(s) en ${g.clave}`,
    antes: { alumnos: g.alumnos },
    despues: { alumnos: nuevo },
  });
  // Afecta varias pantallas, no solo Compactación.
  revalidatePath("/compactacion");
  revalidatePath("/aulas");
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/historial");
  revalidatePath("/");
  return { ok: true };
}

// Edita la razón (comentario) de una compactación ya creada. Queda en el historial.
export async function editarRazonCompactacion(
  compactacionId: number, razon: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await exigirSesionActiva();
  const [c] = await q<{ id: number; razon: string | null; materia: string | null }>(
    `select c.id, c.razon, m.nombre materia from compactaciones c left join materias m on m.id=c.materia_id where c.id=$1`,
    [compactacionId]);
  if (!c) return { ok: false, error: "Esa compactación ya no existe (quizá se separó)." };
  const nueva = razon.trim() || null;
  if ((c.razon ?? null) === nueva) return { ok: true };   // sin cambio real
  await q(`update compactaciones set razon=$1 where id=$2`, [nueva, compactacionId]);
  await registrarCambio({
    entidad: "compactacion",
    entidadId: compactacionId,
    accion: "editó",
    descripcion: `Editó la razón de la clase compactada de "${c.materia ?? "materia"}"${nueva ? `: ${nueva}` : " (la dejó sin razón)"}`,
    antes: { razon: c.razon },
    despues: { razon: nueva },
  });
  revalidatePath("/compactacion");
  revalidatePath("/historial");
  return { ok: true };
}

// Agrega más grupos a una compactación EXISTENTE: los liga al mismo contenedor y adopta el
// horario (y el docente, si la clase tiene uno solo) de la clase. Mismo plantel y materia que la clase
// (salvo confirmación). 100% reversible con "separar" (que desliga a todos).
export async function agregarACompactacion(
  compactacionId: number,
  slotIds: number[],
  opts: { confirmarMateriaDistinta?: boolean } = {},
): Promise<CompactarResult> {
  await exigirSesionActiva();
  const act = await cicloActivo();

  const ids = [...new Set((slotIds ?? []).filter((n) => Number.isFinite(n)))];
  if (ids.length < 1) return { ok: false, error: "Selecciona al menos un grupo para agregar a la clase." };

  const [cont] = await q<{ id: number; materia_id: number | null; plantel: string | null }>(
    `select id, materia_id, plantel from compactaciones where id=$1 and ciclo_id=${act.id}`, [compactacionId]);
  if (!cont) return { ok: false, error: "Esa compactación ya no existe (quizá se separó). Recarga la pantalla." };

  // Horario y docente representativos de la clase (de sus miembros actuales).
  const miembros = await q<{ id: number; dia: string | null; hora_inicio: string | null; hora_fin: string | null; profesor_id: number | null; tipo: string | null }>(
    `select s.id, s.dia, s.hora_inicio, s.hora_fin, a.profesor_id, s.tipo
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.compactacion_id=$1 and s.ciclo_id=${act.id}`, [compactacionId]);
  if (miembros.length === 0) return { ok: false, error: "La clase compactada no tiene grupos. Recarga la pantalla." };
  const base = miembros[0];
  const profes = [...new Set(miembros.map((m) => m.profesor_id).filter((x): x is number => x != null))];
  const docenteClase = profes.length === 1 ? profes[0] : null;
  const tipoClase = (base.tipo ?? "").trim().toUpperCase();

  // Los grupos nuevos a ligar. Validamos TODO antes de escribir.
  const filas = await q<{
    id: number; materia_id: number | null; materia: string | null; plantel: string | null;
    compactacion_id: number | null; no_apertura: boolean; grupo: string | null; tipo: string | null;
  }>(
    `select s.id, s.materia_id, m.nombre materia, s.plantel, s.compactacion_id, s.no_apertura, g.clave grupo, s.tipo
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
      where s.id = any($1) and s.ciclo_id = ${act.id}`, [ids]);

  if (filas.length !== ids.length)
    return { ok: false, error: "Algún grupo seleccionado ya no existe en el cuatrimestre actual. Recarga la pantalla." };
  if (filas.some((f) => f.no_apertura))
    return { ok: false, error: "Hay un grupo marcado como “no se apertura”. Reactívalo o quítalo de la selección." };
  if (filas.some((f) => f.compactacion_id != null))
    return { ok: false, error: "Uno de los grupos ya está compactado (en esta u otra clase). Sepáralo primero." };
  if (filas.some((f) => (f.plantel ?? "") !== (cont.plantel ?? "")))
    return { ok: false, error: "Solo se pueden agregar grupos del MISMO plantel de la clase compactada." };
  if (tipoClase && filas.some((f) => (f.tipo ?? "").trim().toUpperCase() !== tipoClase))
    return { ok: false, error: "El grupo es de distinto tipo de clase (Disciplinar / Módulo / Virtual) que la clase compactada. Solo se agrega la MISMA clase." };
  if (filas.some((f) => f.materia_id !== cont.materia_id) && !opts.confirmarMateriaDistinta)
    return {
      ok: false, needsConfirm: "materia",
      error: `Algún grupo tiene una materia con distinto nombre (${[...new Set(filas.map((f) => f.materia))].filter(Boolean).join(" / ")}). Confirma que es la misma clase para agregarlo de todos modos.`,
    };

  // Choque del docente de la clase contra OTRAS clases suyas a esa hora (excluye la propia clase y los nuevos).
  const efDia = base.dia, efHi = base.hora_inicio, efHf = base.hora_fin;
  if (docenteClase && efDia && efHi && efHf) {
    const excluir = [...new Set([...ids, ...miembros.map((m) => m.id)])];
    const [choque] = await q<{ mat: string }>(
      `select coalesce(m2.nombre,'otra clase') || coalesce(' · ' || g2.clave,'') mat
         from asignaciones a2 join slots s2 on s2.id=a2.slot_id
         left join materias m2 on m2.id=s2.materia_id
         left join grupos g2 on g2.id=s2.grupo_id
        where a2.profesor_id=$1 and s2.ciclo_id=${act.id} and s2.id <> all($2)
          and s2.dia=$3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
        order by s2.hora_inicio limit 1`,
      [docenteClase, excluir, efDia, efHi, efHf]);
    if (choque) return { ok: false, error: `El docente de la clase ya da "${choque.mat}" a esa hora: no se puede agregar este grupo sin empalmarlo.` };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    // El grupo nuevo adopta el horario de la clase (una clase = un horario).
    await client.query(`update slots set dia=$1, hora_inicio=$2, hora_fin=$3 where id = any($4)`,
      [efDia, efHi, efHf, ids]);
    // TOCTOU: solo liga los que SIGUEN libres; si alguno se compactó entremedias, abortamos.
    const ligado = await client.query(
      `update slots set compactacion_id=$1 where id = any($2) and compactacion_id is null`, [compactacionId, ids]);
    if (ligado.rowCount !== ids.length)
      throw new Error("Uno de los grupos fue compactado por otra operación. Recarga e inténtalo de nuevo.");
    if (docenteClase)
      await client.query(
        `insert into asignaciones (slot_id, profesor_id, estado, puntaje, razon, automatica)
         select unnest($1::int[]), $2, 'confirmada', null, 'Agregado a clase compactada', false
         on conflict (slot_id) do update
           set profesor_id=excluded.profesor_id, estado='confirmada', puntaje=excluded.puntaje, razon=excluded.razon, automatica=false`,
        [ids, docenteClase]);
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows), act.id);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return { ok: false, error: `No se pudo agregar: ${e instanceof Error ? e.message : "error desconocido"}` };
  } finally {
    client.release();
  }

  const grupos = filas.map((f) => f.grupo).filter(Boolean).join(", ");
  await registrarCambio({
    entidad: "compactacion",
    entidadId: compactacionId,
    accion: "editó",
    descripcion: `Agregó ${ids.length} grupo(s) a la clase compactada de "${filas[0].materia ?? "materia"}"${cont.plantel ? ` (${cont.plantel})` : ""}: ${grupos}`,
    despues: { id: compactacionId, slotIdsAgregados: ids },
  });

  revalidatePath("/compactacion");
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/historial");
  revalidatePath("/");
  return { ok: true, id: compactacionId };
}

// Unifica el horario de una clase compactada: aplica un mismo día+hora a TODOS sus grupos.
// Solo hace falta cuando alguien dejó la clase con horarios distintos (editando un grupo aparte
// en Asignación). Es reversible: cada grupo conserva su autonomía si luego se "separa".
export async function homogeneizarHorarioCompactacion(
  compactacionId: number,
  horario: { dia: string; hora_inicio: string; hora_fin: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await exigirSesionActiva();
  const act = await cicloActivo();

  const [c] = await q<{ id: number; materia: string | null; plantel: string | null }>(
    `select c.id, m.nombre materia, c.plantel from compactaciones c left join materias m on m.id=c.materia_id where c.id=$1 and c.ciclo_id=${act.id}`,
    [compactacionId]);
  if (!c) return { ok: false, error: "Esa compactación ya no existe (quizá se separó)." };

  const dia = horario.dia?.trim();
  const hi = limpiarHora(horario.hora_inicio ?? "");
  const hf = limpiarHora(horario.hora_fin ?? "");
  if (!dia || !hi || !hf) return { ok: false, error: "El horario elegido no es válido (día y hora inicio–fin en formato HH:MM)." };

  const miembros = await q<{ id: number; profesor_id: number | null }>(
    `select s.id, a.profesor_id from slots s left join asignaciones a on a.slot_id=s.id where s.compactacion_id=$1 and s.ciclo_id=${act.id}`,
    [compactacionId]);
  if (miembros.length === 0) return { ok: false, error: "La clase compactada no tiene grupos. Recarga la pantalla." };
  const ids = miembros.map((m) => m.id);

  // Choque de cada docente de la clase contra OTRAS clases suyas (fuera de esta compactación) a ese horario.
  const profes = [...new Set(miembros.map((m) => m.profesor_id).filter((x): x is number => x != null))];
  for (const prof of profes) {
    const [choque] = await q<{ mat: string }>(
      `select coalesce(m2.nombre,'otra clase') || coalesce(' · ' || g2.clave,'') mat
         from asignaciones a2 join slots s2 on s2.id=a2.slot_id
         left join materias m2 on m2.id=s2.materia_id
         left join grupos g2 on g2.id=s2.grupo_id
        where a2.profesor_id=$1 and s2.ciclo_id=${act.id} and s2.id <> all($2)
          and s2.dia=$3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
        order by s2.hora_inicio limit 1`,
      [prof, ids, dia, hi, hf]);
    if (choque) return { ok: false, error: `Un docente de la clase ya da "${choque.mat}" a esa hora: elige otro horario para no empalmarlo.` };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`update slots set dia=$1, hora_inicio=$2, hora_fin=$3 where compactacion_id=$4 and ciclo_id=${act.id}`,
      [dia, hi, hf, compactacionId]);
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows), act.id);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return { ok: false, error: `No se pudo unificar el horario: ${e instanceof Error ? e.message : "error desconocido"}` };
  } finally {
    client.release();
  }

  await registrarCambio({
    entidad: "compactacion",
    entidadId: compactacionId,
    accion: "editó",
    descripcion: `Unificó el horario de la clase compactada de "${c.materia ?? "materia"}"${c.plantel ? ` (${c.plantel})` : ""} a ${dia} ${hi}–${hf}`,
    despues: { id: compactacionId, dia, hora_inicio: hi, hora_fin: hf },
  });

  revalidatePath("/compactacion");
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/historial");
  revalidatePath("/");
  return { ok: true };
}
