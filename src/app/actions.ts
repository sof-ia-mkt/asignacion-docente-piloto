"use server";
// Acciones de coordinación. Las de slot NO llaman a Claude (todo es BD, $0).
// crearDocente por CV SÍ llama a Claude una vez (~$0.05); por camino manual es $0.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { q, pool } from "@/lib/db";
import { sqlMismoPeriodo } from "@/lib/queries";
import { cicloActivo, getCiclos, motivoCicloSoloLectura } from "@/lib/ciclo";
import { leerCV } from "@/lib/cv";
import { nombresCoordinadores } from "@/lib/usuarios-db";
import { recomputarAlertas } from "@/lib/alertas-core.mjs";
import { registrarCambio } from "@/lib/audit";
import { exigirSesionActiva } from "@/lib/session";
import {
  aplicarReversion, type Snap,
  snapAsignacion, snapAsignacionMulti, snapSlotAula, snapSlotHorario, snapSlotApertura, snapSlotMateria, snapSlotTipo, snapSlotPlantel, snapSlotGrupo, snapSlotIdExcel, snapMateria, snapAula, snapDocente, snapCandidatura, snapPropuesta,
} from "@/lib/revertir";

// Recalcula las alertas desde el ESTADO ACTUAL (diagnóstico; NO reasigna docentes ni aulas).
// Misma fuente de verdad que el motor (src/lib/alertas-core.mjs). Se llama tras cada edición
// para que el panel de alertas nunca quede como una foto vieja. Va en su propia transacción.
async function recalcularAlertas() {
  const act = await cicloActivo();
  // Ciclo de historial: su diagnóstico está congelado (no se generan alertas nuevas para
  // un ciclo cerrado). Las acciones globales (docentes, candidaturas, aulas) pueden correr
  // viendo historial; el recálculo simplemente no aplica ahí.
  if (act.estado !== "planeacion") return;
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
  await exigirSesionActiva();   // misma regla que toda acción mutante (cambia a qué ciclo apuntan las siguientes)
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

// Validación del archivo de CV ANTES de mandarlo a Claude (~$0.05/llamada). El MIME lo
// declara el navegador (falsificable); el tamaño y los bytes iniciales `%PDF-` no. Sin el
// tope, un archivo enorme es costo de API y memoria del servidor.
const MAX_CV_MB = 5;
async function validarCV(file: unknown): Promise<{ ok: true; pdf: Buffer } | { ok: false; error: string }> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Sube el archivo PDF del CV." };
  if (file.type !== "application/pdf") return { ok: false, error: "El CV debe ser un archivo PDF." };
  if (file.size > MAX_CV_MB * 1024 * 1024)
    return { ok: false, error: `El CV pesa más de ${MAX_CV_MB} MB. Reduce el PDF (quita imágenes pesadas o re-exporta) y vuelve a subirlo.` };
  const pdf = Buffer.from(await file.arrayBuffer());
  if (pdf.length < 5 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
    return { ok: false, error: "El archivo no es un PDF válido (el contenido no corresponde a un PDF). Exporta el CV como PDF y vuelve a subirlo." };
  return { ok: true, pdf };
}

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
    const cvv = await validarCV(fd.get("cv"));
    if (!cvv.ok) return { error: cvv.error };
    pdf = cvv.pdf;
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
    // (Solo si el ciclo visto está en planeación: el diagnóstico de historial está congelado.)
    const actCiclo = await cicloActivo();
    if (actCiclo.estado === "planeacion")
      await recomputarAlertas((sql: string, params: unknown[] = []) =>
        client.query(sql, params).then((r) => r.rows), actCiclo.id);
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
// llamadas directas. Los errores esperados se DEVUELVEN como { error } (no se lanzan): un
// throw desde una server action se redacta en producción y el usuario no vería el mensaje.
export async function asignar(slotId: number, profesorId: number, puntaje?: number, razon?: string): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: los ciclos de historial son solo lectura
  if (bloqueo) return { error: bloqueo };
  const [s] = await q<{ modalidad: string | null; dia: string | null; hora_inicio: string | null; hora_fin: string | null; compactacion_id: number | null; tipo: string | null }>(
    `select modalidad, dia, hora_inicio, hora_fin, compactacion_id, tipo from slots where id=$1 and ciclo_id=${act.id}`, [slotId]);
  if (!s) return { error: "La clase no existe o no es del cuatrimestre a asignar." };
  const asincronica = (s.modalidad ?? "").toUpperCase().includes("ASINCR");
  const sinHorario = !s.dia || !s.hora_inicio || !s.hora_fin;
  if (sinHorario && !asincronica)
    return { error: "Esta clase presencial aún no tiene horario. Captura el día y la hora antes de asignar un docente (así se evita empalmar al maestro)." };
  // Si la clase está COMPACTADA, el docente cubre TODOS sus grupos (es una sola clase):
  // asignamos a todos los slots miembros y el choque ignora a los hermanos (no chocan entre sí).
  const objetivos = s.compactacion_id
    ? (await q<{ id: number }>(`select id from slots where compactacion_id=$1 and ciclo_id=${act.id}`, [s.compactacion_id])).map((r) => r.id)
    : [slotId];
  if (!objetivos.includes(slotId)) objetivos.push(slotId);
  // Chequeo de empalme + escritura + fotos en UNA transacción, con candado por docente:
  // dos coordinadores asignando al MISMO docente a la vez se serializan aquí, así el
  // check-then-insert no puede pasar dos veces "en paralelo" y crear un empalme. Además
  // las fotos del antes/después se leen dentro de la transacción: reflejan exactamente
  // lo que ESTA acción escribió (una relectura suelta podría capturar el cambio de otro).
  let antes: Snap, despues: Snap;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const exec = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows as T[]);
    // Candado por docente (se libera al commit/rollback). OJO: la forma de DOS argumentos
    // toma enteros de 32 bits (int4, int4) — la constante debe caber en int4.
    await exec("select pg_advisory_xact_lock(492813475, $1::int)", [profesorId]);
    if (!sinHorario) {
      const [choque] = await exec<{ mat: string }>(
        `select coalesce(m2.nombre, 'otra clase') || coalesce(' · ' || g2.clave, '') mat
           from asignaciones a2
           join slots s2 on s2.id = a2.slot_id
           left join materias m2 on m2.id = s2.materia_id
           left join grupos g2 on g2.id = s2.grupo_id
          where a2.profesor_id = $1 and s2.ciclo_id = ${act.id} and s2.id <> all($2)
            and not s2.no_apertura
            and s2.dia = $3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
            and ${sqlMismoPeriodo("$6", "s2.tipo")}
          order by s2.hora_inicio limit 1`,
        [profesorId, objetivos, s.dia, s.hora_inicio, s.hora_fin, s.tipo]);
      if (choque)
        throw new Error(`Ese docente ya da "${choque.mat}" a esa misma hora. No se puede empalmar: primero libéralo de esa clase o cambia el horario de alguna de las dos.`);
    }
    antes = await snapAsignacionMulti(objetivos, exec);   // foto del antes (todos los grupos de la clase)
    await exec(
      `insert into asignaciones (slot_id, profesor_id, estado, puntaje, razon, automatica)
       select unnest($1::int[]), $2, 'confirmada', $3, $4, false
       on conflict (slot_id) do update
         set profesor_id = excluded.profesor_id,
             estado = 'confirmada',
             puntaje = excluded.puntaje,
             razon = excluded.razon,
             automatica = false`,
      [objetivos, profesorId, puntaje ?? null, razon ?? null]);
    despues = await snapAsignacionMulti(objetivos, exec);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    // Error esperado (choque) o inesperado (BD): en ambos casos el usuario ve el motivo
    // inline en el botón, en vez de la pantalla de error genérica.
    return { error: e instanceof Error ? e.message : "No se pudo asignar (error desconocido)." };
  } finally {
    client.release();
  }
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
    despues,
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
export async function confirmar(slotId: number, profesorId?: number): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: los ciclos de historial son solo lectura
  if (bloqueo) return { error: bloqueo };
  const antes = await snapAsignacion(slotId);   // foto del antes (estado previo)
  // Candado de integridad (no solo UI): no se puede "confirmar" una clase sin docente,
  // ni una clase fuera del ciclo activo (misma regla que asignar/editar: pantallas viejas
  // apuntando a otro ciclo no deben mutar nada).
  const upd = await q<{ slot_id: number }>(
    `update asignaciones set estado='confirmada', automatica=false
      where slot_id=$1 and profesor_id is not null
        and exists (select 1 from slots s where s.id=$1 and s.ciclo_id=${act.id})
      returning slot_id`, [slotId]);
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
  filtro: { plantel?: string; cuatri?: string; tipo?: string[]; q?: string; plan?: string[]; turno?: string[]; modalidad?: string[]; comp?: string } = {},
): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: los ciclos de historial son solo lectura
  if (bloqueo) return { error: bloqueo };
  // MISMO alcance que contarSugeridas (el número del botón): nunca tocar clases parqueadas.
  const conds: string[] = [`s.ciclo_id = ${act.id}`, "not s.no_apertura"];
  const params: unknown[] = [];
  if (filtro.plantel) { params.push(filtro.plantel); conds.push(`s.plantel = $${params.length}`); }
  if (filtro.cuatri) { params.push(filtro.cuatri); conds.push(`s.cuatrimestre = $${params.length}`); }
  if (filtro.tipo?.length) { params.push(filtro.tipo); conds.push(`s.tipo = ANY($${params.length})`); }
  if (filtro.plan?.length) { params.push(filtro.plan); conds.push(`g.plan_id in (select id from planes where nombre = ANY($${params.length}))`); }
  if (filtro.turno?.length) { params.push(filtro.turno); conds.push(`split_part(g.clave, '_', 3) = ANY($${params.length})`); }
  if (filtro.modalidad?.length) { params.push(filtro.modalidad); conds.push(`s.modalidad = ANY($${params.length})`); }
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
      filtro.plantel, filtro.cuatri && `cuatri ${filtro.cuatri}`,
      filtro.tipo?.length && filtro.tipo.join("/"),
      filtro.plan?.length && filtro.plan.join("/"),
      filtro.turno?.length && `turno ${filtro.turno.join("/")}`,
      filtro.modalidad?.length && filtro.modalidad.join("/"),
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
export async function asignarAula(slotId: number, aulaId: number): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: los ciclos de historial son solo lectura
  if (bloqueo) return { error: bloqueo };
  const antes = await snapSlotAula(slotId);   // foto del aula previa (para deshacer)
  // aula_manual = true: el motor (asignar.mjs) ya no recalcula ni pisa este salón.
  // Candado de ciclo (misma regla que asignar/editar): solo clases del ciclo activo.
  const upd = await q<{ id: number }>(
    `update slots set aula_id = $1, aula_manual = true where id = $2 and ciclo_id=${act.id} returning id`, [aulaId, slotId]);
  if (!upd.length) return;
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
    // Foto determinista de lo escrito (no relectura): bajo concurrencia, releer podría
    // capturar el cambio de otro coordinador y el deshacer pisaría su trabajo en silencio.
    despues: { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { aula_id: aulaId, aula_manual: true } },
  });
  await recalcularAlertas();   // detecta choque_aula y quita sin_aula de este slot, sobre el estado actual
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Quita el aula del slot (lo deja sin salón). El recálculo limpia el choque y, si es presencial, levanta sin_aula.
export async function quitarAula(slotId: number): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  const [info] = await q<{ materia: string | null; grupo: string | null; aula: string | null }>(
    `select m.nombre materia, g.clave grupo, au.clave aula
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join aulas au on au.id = s.aula_id
      where s.id = $1`, [slotId]);
  const antes = await snapSlotAula(slotId);   // foto del aula previa (para deshacer)
  // Candado de ciclo (misma regla que asignar/editar): solo clases del ciclo activo Y editable.
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);
  if (bloqueo) return { error: bloqueo };
  const upd = await q<{ id: number }>(
    `update slots set aula_id = null, aula_manual = false where id = $1 and ciclo_id=${act.id} returning id`, [slotId]);
  if (!upd.length) return;
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "quitó",
    descripcion: `Quitó el aula${info?.aula ? ` "${info.aula}"` : ""} de "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""}`,
    antes,
    // Foto determinista de lo escrito (no relectura): ver nota en asignarAula.
    despues: { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { aula_id: null, aula_manual: false } },
  });
  await recalcularAlertas();
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
}

// Quita la asignación del slot (lo deja sin docente).
// profesorId es opcional: si viene (p. ej. al quitar desde la ficha del docente),
// también se refresca esa página para que la clase desaparezca de su lista al instante.
export async function quitarAsignacion(slotId: number, profesorId?: number): Promise<{ error: string } | void> {
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
  const bloqueo = motivoCicloSoloLectura(act);   // candado: los ciclos de historial son solo lectura
  if (bloqueo) return { error: bloqueo };
  const [sc] = await q<{ compactacion_id: number | null }>(
    `select compactacion_id from slots where id=$1 and ciclo_id=${act.id}`, [slotId]);
  // Candado de ciclo: si la clase no es del ciclo activo (pantalla vieja apuntando a otro
  // ciclo), no se muta nada — misma regla que asignar/editar.
  if (!sc) return;
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
export async function eliminarDocente(profesorId: number): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  // Borrar un docente libera clases y desliga historial: no desde un ciclo cerrado.
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);
  if (bloqueo) return { error: bloqueo };
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
    // Sus alertas van primero: alertas.profesor_id es FK SIN cascade y bloquearía el delete
    // (recomputarAlertas regenera abajo las que apliquen a las clases liberadas).
    await client.query("delete from alertas where profesor_id=$1", [profesorId]);
    await client.query("delete from profesores where id=$1", [profesorId]); // cascade: cv + candidatos
    // Recalcula alertas dentro de la MISMA transacción: sus clases quedan libres (posible
    // sin_candidato/choque) y desaparece su sobrecarga. Una sola foto coherente del estado final.
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows), act.id);
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

export type EditarAulaState = { error?: string };

// Edita tipo y capacidad de un salón existente (la clave es su identificador y no se cambia aquí).
// Capturar la capacidad faltante permite que el acomodo automático vuelva a considerar el salón.
// Una capacidad inválida se RECHAZA con mensaje (antes se guardaba NULL en silencio, borrando el dato).
export async function editarAula(aulaId: number, _prev: EditarAulaState, fd: FormData): Promise<EditarAulaState> {
  await exigirSesionActiva();
  const tipo = String(fd.get("tipo") ?? "").trim() || null;
  const cap = parseCapacidad(String(fd.get("capacidad") ?? ""));
  if (!cap.ok) return { error: "La capacidad debe ser un número entero mayor que 0 (o déjala vacía). No se guardó." };
  const antes = await snapAula(aulaId);   // foto del tipo/cupo previos (para deshacer)
  await q("update aulas set tipo=$1, capacidad=$2 where id=$3",
    [tipo, cap.val, aulaId]);
  const [a] = await q<{ clave: string }>("select clave from aulas where id=$1", [aulaId]);
  await registrarCambio({
    entidad: "aula",
    entidadId: aulaId,
    accion: "editó",
    descripcion: `Editó el salón "${a?.clave ?? `#${aulaId}`}"${tipo ? ` (${tipo})` : ""}${cap.ok && cap.val != null ? ` · cupo ${cap.val}` : ""}`,
    antes,
    // Foto determinista de lo que ESTA acción escribió (no una relectura que otra
    // acción concurrente podría haber pisado): así el deshacer compara contra lo real.
    despues: { kind: "row", tabla: "aulas", clave: { id: aulaId }, campos: { tipo, capacidad: cap.ok ? cap.val : null } },
  });
  // La capacidad alimenta la alerta "ningún salón alcanza" y el acomodo automático:
  // sin recálculo, /alertas mostraría el diagnóstico viejo.
  await recalcularAlertas();
  revalidatePath("/aulas");
  revalidatePath("/alertas");
  revalidatePath("/");
  return {};
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
// Si ya existía una candidatura MÁS DÉBIL (p. ej. 'cv' con 15 pts, bajo el umbral de 25), se
// SUBE a +40/'historial': antes el "do nothing" la descartaba en silencio y el docente seguía
// sin aparecer como candidato aunque coordinación lo marcara explícitamente.
// Una candidatura nueva puede resolver un "sin_candidato", así que recalculamos alertas.
export type CandidaturaState = { error?: string; ok?: string };

export async function agregarCandidatura(profesorId: number, _prev: CandidaturaState, fd: FormData): Promise<CandidaturaState> {
  await exigirSesionActiva();
  const materiaNombre = String(fd.get("materia") ?? "").trim();
  if (!materiaNombre) return { error: "Escribe el nombre de la materia." };
  const [m] = await q<{ id: number; nombre: string }>("select id, nombre from materias where lower(nombre)=lower($1)", [materiaNombre]);
  // Sólo materias que ya existen en el catálogo (antes esto era un return mudo: el usuario
  // pulsaba "Agregar" y no pasaba nada, sin saber por qué).
  if (!m) return { error: `"${materiaNombre}" no está en el catálogo. Elígela de la lista de sugerencias, tal como aparece escrita.` };
  const antes = await snapCandidatura(profesorId, m.id);   // foto del conjunto previo (para deshacer)
  // 'returning' solo devuelve fila si realmente insertó o subió el puntaje (el WHERE del
  // do update filtra los casos "ya tenía 40 o más": ahí no hay cambio ni bitácora).
  const ins = await q<{ materia_id: number }>(
    `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
     values ($1,$2,'historial',40,'Agregado por coordinación: puede dar esta materia')
     on conflict (profesor_id, materia_id) do update
       set fuente = excluded.fuente, puntaje = excluded.puntaje, razon = excluded.razon
       where materia_candidatos.puntaje < excluded.puntaje
     returning materia_id`, [profesorId, m.id]);
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
  return ins.length
    ? { ok: `"${m.nombre}" agregada como materia que puede dar (+40).` }
    : { ok: `Ya tenía "${m.nombre}" registrada con señal fuerte; no hubo cambios.` };
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

  const cvv = await validarCV(fd.get("cv"));
  if (!cvv.ok) return { error: cvv.error };
  const pdf = cvv.pdf;

  let res;
  try {
    res = await leerCV(pdf, prof.nombre);
  } catch (e) {
    return { error: `No se pudo leer el CV: ${e instanceof Error ? e.message : "error desconocido"}` };
  }

  // Toda la escritura en UNA transacción (perfil + payload de auditoría + candidaturas +
  // alertas): si algo falla a la mitad (p. ej. corte del pooler), no queda un docente a
  // medias con cv_archivo actualizado pero sin candidaturas. Mismo patrón que crearDocente.
  let nuevas = 0;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const exec = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows as T[]);

    // Actualiza los datos del docente con lo del CV (conserva lo previo si Claude no lo trae).
    await exec(
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
    await exec(
      `insert into cv_competencias (profesor_id, payload, modelo) values ($1,$2,$3)
       on conflict (profesor_id) do update set payload = excluded.payload, modelo = excluded.modelo, creado_en = now()`,
      [profesorId, res.perfil, res.modelo]);

    // Suma materias candidatas EN LOTE (antes: un insert por candidatura, N viajes).
    // 'returning' con 'do nothing' solo devuelve las realmente insertadas.
    if (res.candidaturas.length) {
      const ins = await exec<{ materia_id: number }>(
        `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
         select $1, t.m, 'cv', t.p, t.r
           from unnest($2::int[], $3::int[], $4::text[]) as t(m, p, r)
         on conflict (profesor_id, materia_id) do nothing
         returning materia_id`,
        [profesorId,
         res.candidaturas.map((c) => c.materia_id),
         res.candidaturas.map((c) => c.puntaje),
         res.candidaturas.map((c) => c.razon)]);
      nuevas = ins.length;
    }

    // Alertas en la misma transacción (solo en planeación: el diagnóstico de historial está congelado).
    const actCiclo = await cicloActivo();
    if (actCiclo.estado === "planeacion")
      await recomputarAlertas((sql: string, params: unknown[] = []) =>
        client.query(sql, params).then((r) => r.rows), actCiclo.id);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return { error: `No se pudo guardar lo extraído del CV: ${e instanceof Error ? e.message : "error desconocido"}` };
  } finally {
    client.release();
  }

  const total = res.candidaturas.length;
  await registrarCambio({
    entidad: "cv",
    entidadId: profesorId,
    accion: "procesó",
    descripcion: `Procesó el CV de "${prof.nombre}": ${total} materia(s) propuesta(s), ${nuevas} nueva(s)`,
    despues: { profesorId, propuestas: total, nuevas },
  });

  // (Las alertas ya se recalcularon dentro de la transacción de arriba.)
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

export type EditarHorarioState = { ok?: string; error?: string };

// Edita día y horario de una materia por grupo. NO re-corre el motor (no reasigna docentes),
// pero sí recalcula las alertas: cambiar la hora puede crear o resolver choques y traslados.
export async function editarHorario(slotId: number, _prev: EditarHorarioState, fd: FormData): Promise<EditarHorarioState> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { error: bloqueo };
  // Mayúsculas: los slots guardan "LUNES" y la detección de choques compara el día como texto.
  const dia = String(fd.get("dia") ?? "").trim().toUpperCase() || null;
  let hi = limpiarHora(String(fd.get("hora_inicio") ?? ""));
  let hf = limpiarHora(String(fd.get("hora_fin") ?? ""));
  // Las horas van en par: la detección de choques compara inicio–fin como rango.
  // Una hora suelta (solo inicio o solo fin) no es un horario usable, así que la
  // descartamos antes de guardar para no dejar un horario a medias.
  if (!hi || !hf) { hi = null; hf = null; }
  // Un rango invertido o de duración cero nunca "traslapa" con nada: escondería
  // empalmes reales de docente y de aula. Se rechaza en la captura.
  if (hi && hf && hi >= hf)
    return { error: `El horario está invertido o vacío (${hi}–${hf}): la hora de inicio debe ser antes que la de fin.` };
  const [info] = await q<{ materia: string | null; grupo: string | null; tipo: string | null; modalidad: string | null }>(
    `select m.nombre materia, g.clave grupo, s.tipo, s.modalidad from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id where s.id = $1 and s.ciclo_id = ${act.id}`, [slotId]);
  if (!info) return { error: "No se encontró la clase en el ciclo activo." };
  // Coherencia VIRTUAL (misma regla que al crear): las virtuales/asincrónicas no llevan
  // día ni hora — sin este candado, la regla se podía romper EDITANDO aunque no creando.
  if ((dia || hi || hf) && (info.tipo === "VIRTUAL" || (info.modalidad ?? "").toUpperCase().includes("ASINCR")))
    return { error: "Esta clase es VIRTUAL (asincrónica): no lleva día ni hora, como todas las demás virtuales. Si de verdad tendrá horario fijo, primero cámbiale el tipo." };
  const antes = await snapSlotHorario(slotId);   // foto del horario previo (para deshacer)
  await q(`update slots set dia=$1, hora_inicio=$2, hora_fin=$3 where id=$4 and ciclo_id=${act.id}`,
    [dia, hi, hf, slotId]);
  const horarioTxt = dia && hi && hf ? `${dia} ${hi}-${hf}` : "sin horario";
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Editó el horario de "${info?.materia ?? "clase"}"${info?.grupo ? ` · ${info.grupo}` : ""} → ${horarioTxt}`,
    antes,
    // Foto determinista de lo escrito (no relectura): ver nota en asignarAula.
    despues: { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { dia, hora_inicio: hi, hora_fin: hf } },
  });
  await recalcularAlertas();   // cambiar día/hora puede crear o resolver choques, traslados y choques de aula
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  return { ok: `Horario guardado: ${horarioTxt}.` };
}

// ---------- Edición inline desde la lista: materia y tipo de la clase ----------

// Los 5 tipos válidos de clase. La lógica de choques (MÓDULO 1/2/3 secuenciales) y las
// alertas dependen de estos valores EXACTOS: por eso el tipo nunca se captura como texto libre.
const TIPOS_CLASE = ["DISCIPLINAR", "MÓDULO 1", "MÓDULO 2", "MÓDULO 3", "VIRTUAL"];

export type EditarClaseState = { ok?: string; error?: string };

// Re-apunta la clase a OTRA materia del catálogo (no toca el catálogo: cero riesgo de typo).
// Para corregir un nombre mal escrito está renombrarMateria, que es otra operación.
export async function editarMateriaSlot(slotId: number, materiaId: number): Promise<EditarClaseState> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { error: bloqueo };
  if (!Number.isFinite(materiaId)) return { error: "Materia no válida." };
  const [nueva] = await q<{ nombre: string }>("select nombre from materias where id=$1", [materiaId]);
  if (!nueva) return { error: "Esa materia no existe en el catálogo." };
  const [info] = await q<{ materia: string | null; grupo: string | null }>(
    `select m.nombre materia, g.clave grupo from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id where s.id = $1 and s.ciclo_id = ${act.id}`, [slotId]);
  if (!info) return { error: "No se encontró la clase en el ciclo activo." };

  const antes = await snapSlotMateria(slotId);   // foto SOLO del campo que esta acción toca
  await q(`update slots set materia_id=$1 where id=$2 and ciclo_id=${act.id}`, [materiaId, slotId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Cambió la materia de la clase${info.grupo ? ` ${info.grupo}` : ""}: "${info.materia ?? "sin materia"}" → "${nueva.nombre}"`,
    antes,
    despues: { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { materia_id: materiaId } },
  });
  await recalcularAlertas();   // otra materia = otros candidatos posibles (sin_candidato puede cambiar)
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
  return { ok: `Materia cambiada a "${nueva.nombre}".` };
}

// Cambia el tipo de la clase (Disciplinar / Módulo 1-3 / Virtual). Solo valores del catálogo fijo.
export async function editarTipoSlot(slotId: number, tipo: string): Promise<EditarClaseState> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { error: bloqueo };
  if (!TIPOS_CLASE.includes(tipo)) return { error: "Tipo de clase no válido." };
  const [info] = await q<{ materia: string | null; grupo: string | null; tipo: string | null; modalidad: string | null; dia: string | null; hora_inicio: string | null; hora_fin: string | null }>(
    `select m.nombre materia, g.clave grupo, s.tipo, s.modalidad, s.dia, s.hora_inicio, s.hora_fin from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id where s.id = $1 and s.ciclo_id = ${act.id}`, [slotId]);
  if (!info) return { error: "No se encontró la clase en el ciclo activo." };
  if (info.tipo === tipo) return { ok: "Sin cambios." };

  // Coherencia VIRTUAL ⇔ ASINCRÓNICA (regla sin excepciones en los datos): cambiar el tipo
  // hacia/desde VIRTUAL ajusta también la modalidad — y al volverse virtual, quita el horario
  // (las virtuales no llevan día ni hora). La foto abarca TODOS los campos tocados, para que
  // el deshacer restaure la clase completa y no deje una combinación imposible.
  const seraVirtual = tipo === "VIRTUAL";
  const eraVirtual = info.tipo === "VIRTUAL" || (info.modalidad ?? "").toUpperCase().includes("ASINCR");
  const cambiaNaturaleza = seraVirtual !== eraVirtual;
  let antes: Snap, despues: Snap, avisoExtra = "";
  if (cambiaNaturaleza) {
    antes = {
      kind: "row", tabla: "slots", clave: { id: slotId },
      campos: { tipo: info.tipo, modalidad: info.modalidad, dia: info.dia, hora_inicio: info.hora_inicio, hora_fin: info.hora_fin },
    };
    if (seraVirtual) {
      await q(`update slots set tipo=$1, modalidad='ASINCRÓNICA', dia=null, hora_inicio=null, hora_fin=null where id=$2 and ciclo_id=${act.id}`, [tipo, slotId]);
      despues = { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { tipo, modalidad: "ASINCRÓNICA", dia: null, hora_inicio: null, hora_fin: null } };
      avisoExtra = info.dia || info.hora_inicio
        ? " La clase pasó a ASINCRÓNICA y su horario se quitó (las virtuales no llevan día ni hora)."
        : " La clase pasó a ASINCRÓNICA (las virtuales no llevan horario).";
    } else {
      await q(`update slots set tipo=$1, modalidad='PRESENCIAL' where id=$2 and ciclo_id=${act.id}`, [tipo, slotId]);
      despues = { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { tipo, modalidad: "PRESENCIAL", dia: info.dia, hora_inicio: info.hora_inicio, hora_fin: info.hora_fin } };
      avisoExtra = " La clase pasó a PRESENCIAL: captúrale día, hora y aula.";
    }
  } else {
    antes = await snapSlotTipo(slotId);   // foto SOLO del campo que esta acción toca
    await q(`update slots set tipo=$1 where id=$2 and ciclo_id=${act.id}`, [tipo, slotId]);
    despues = { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { tipo } };
  }
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Cambió el tipo de "${info.materia ?? "clase"}"${info.grupo ? ` · ${info.grupo}` : ""}: ${info.tipo ?? "sin tipo"} → ${tipo}${avisoExtra}`,
    antes,
    despues,
  });
  await recalcularAlertas();   // el tipo participa en la detección de choques (módulos secuenciales)
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
  return { ok: `Tipo cambiado a ${tipo}.${avisoExtra}` };
}

// Corrige el PLANTEL de una clase (dato mal cargado del Excel). Select estricto: solo se
// acepta un plantel que YA exista en los datos — cero texto libre, cero typos. Bloqueado en
// clases compactadas: la compactación es POR plantel; cambiarle el plantel a un miembro
// rompería la unidad (sepárala primero).
export async function editarPlantelSlot(slotId: number, plantel: string): Promise<EditarClaseState> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { error: bloqueo };
  const p = plantel.trim();
  if (!p) return { error: "Plantel no válido." };
  const existentes = await q<{ plantel: string }>(
    "select distinct plantel from slots where plantel is not null");
  if (!existentes.some((e) => e.plantel === p)) return { error: "Ese plantel no existe en los datos." };

  const [info] = await q<{ plantel: string | null; compactacion_id: number | null; materia: string | null; grupo: string | null }>(
    `select s.plantel, s.compactacion_id, m.nombre materia, g.clave grupo from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id where s.id = $1 and s.ciclo_id = ${act.id}`, [slotId]);
  if (!info) return { error: "No se encontró la clase en el ciclo activo." };
  if (info.compactacion_id != null)
    return { error: "Esta clase está compactada con otros grupos y la compactación es por plantel. Sepárala primero (en Compactación) si realmente es de otro plantel." };
  if (info.plantel === p) return { ok: "Sin cambios." };

  const antes = await snapSlotPlantel(slotId);   // foto SOLO del campo que esta acción toca
  await q(`update slots set plantel=$1 where id=$2 and ciclo_id=${act.id}`, [p, slotId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Cambió el plantel de "${info.materia ?? "clase"}"${info.grupo ? ` · ${info.grupo}` : ""}: ${info.plantel ?? "sin plantel"} → ${p}`,
    antes,
    despues: { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { plantel: p } },
  });
  await recalcularAlertas();   // el plantel participa en la alerta de traslado entre planteles
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
  return { ok: `Plantel cambiado a ${p}.` };
}

// ¿El grupo (por su clave) pertenece al plantel dado? La clave termina en el código de campus;
// se valida contra los códigos con uso REAL en ese plantel (tolera variantes históricas como
// TEC/TC en Tecate). Devuelve el mensaje de error, o null si es coherente / no hay referencia.
async function validarGrupoDelPlantel(claveGrupo: string, plantel: string | null): Promise<string | null> {
  if (!plantel) return null;
  const codigos = await q<{ campus: string }>(
    `select distinct (string_to_array(g.clave,'_'))[array_length(string_to_array(g.clave,'_'),1)] campus
       from slots s join grupos g on g.id = s.grupo_id
      where s.plantel = $1 and g.clave is not null`, [plantel]);
  if (!codigos.length) return null;   // plantel sin grupos aún: sin referencia para validar
  const campusGrupo = claveGrupo.split("_").at(-1) ?? "";
  if (codigos.some((c) => c.campus === campusGrupo)) return null;
  return `El grupo ${claveGrupo} parece de OTRO plantel: su clave termina en "${campusGrupo}" y los grupos de ${plantel} terminan en ${codigos.map((c) => c.campus).join("/")}. Elige un grupo del mismo plantel (o créalo con el constructor).`;
}

// Re-apunta la clase a OTRO grupo del catálogo (select estricto, sin texto libre).
// Anti-dedazo: si el grupo destino ya lleva esta misma materia y tipo en el ciclo, se
// rechaza (sería un duplicado casi seguro). Bloqueado en compactadas: los grupos de una
// clase compactada se gestionan desde Compactación (agregar/separar), no re-etiquetando.
export async function editarGrupoSlot(slotId: number, grupoId: number): Promise<EditarClaseState> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { error: bloqueo };
  if (!Number.isFinite(grupoId)) return { error: "Grupo no válido." };
  const [g] = await q<{ id: number; clave: string }>("select id, clave from grupos where id=$1", [grupoId]);
  if (!g) return { error: "Ese grupo no existe en el catálogo." };

  const [info] = await q<{ grupo_id: number | null; materia_id: number | null; tipo: string | null; compactacion_id: number | null; plantel: string | null; materia: string | null; grupo: string | null }>(
    `select s.grupo_id, s.materia_id, s.tipo, s.compactacion_id, s.plantel, m.nombre materia, g2.clave grupo from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g2 on g2.id = s.grupo_id where s.id = $1 and s.ciclo_id = ${act.id}`, [slotId]);
  if (!info) return { error: "No se encontró la clase en el ciclo activo." };
  if (info.compactacion_id != null)
    return { error: "Esta clase está compactada: sus grupos se gestionan desde Compactación (agregar grupos o separar), no cambiando la clave aquí." };
  if (info.grupo_id === grupoId) return { ok: "Sin cambios." };

  // Coherencia plantel ⇔ campus: la clave del grupo termina en el código del campus. Solo se
  // aceptan grupos cuyo código ya se use en el plantel de la clase (tolera variantes históricas
  // como TEC/TC): así un dedazo en el select no cuelga un grupo de Palmas a una clase de CB.
  const errCampus = await validarGrupoDelPlantel(g.clave, info.plantel);
  if (errCampus) return { error: errCampus };

  const [dup] = await q<{ id: number }>(
    `select s.id from slots s
      where s.ciclo_id = ${act.id} and s.grupo_id = $1 and s.id <> $2
        and s.materia_id is not distinct from $3 and s.tipo is not distinct from $4
      limit 1`, [grupoId, slotId, info.materia_id, info.tipo]);
  if (dup)
    return { error: `El grupo ${g.clave} ya lleva "${info.materia ?? "esta materia"}"${info.tipo ? ` (${info.tipo})` : ""} en este ciclo (clase #${dup.id}). Cambiarlo crearía un duplicado.` };

  const antes = await snapSlotGrupo(slotId);   // foto SOLO del campo que esta acción toca
  await q(`update slots set grupo_id=$1 where id=$2 and ciclo_id=${act.id}`, [grupoId, slotId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Cambió el grupo de "${info.materia ?? "clase"}": ${info.grupo ?? "sin grupo"} → ${g.clave}`,
    antes,
    despues: { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { grupo_id: grupoId } },
  });
  await recalcularAlertas();   // el grupo aporta alumnos/turno a las alertas de aula
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/");
  return { ok: `Grupo cambiado a ${g.clave}.` };
}

// Corrige el ID (folio del Excel) de una clase. Anti-dedazo: la llave real de los datos es
// ID + plantel (el ID se repite ENTRE planteles pero no dentro de uno) — si otra clase del
// mismo plantel ya usa ese ID en este ciclo, se rechaza diciendo cuál.
export async function editarIdExcelSlot(slotId: number, idExcel: number | null): Promise<EditarClaseState> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { error: bloqueo };
  if (idExcel != null && (!Number.isInteger(idExcel) || idExcel <= 0 || idExcel > 99_999_999))
    return { error: "El ID debe ser un número entero positivo." };

  const [info] = await q<{ id_excel: number | null; plantel: string | null; materia: string | null; grupo: string | null }>(
    `select s.id_excel, s.plantel, m.nombre materia, g.clave grupo from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id where s.id = $1 and s.ciclo_id = ${act.id}`, [slotId]);
  if (!info) return { error: "No se encontró la clase en el ciclo activo." };
  if ((info.id_excel ?? null) === idExcel) return { ok: "Sin cambios." };

  if (idExcel != null) {
    const [dup] = await q<{ materia: string | null; grupo: string | null }>(
      `select m.nombre materia, g.clave grupo from slots s
         left join materias m on m.id = s.materia_id
         left join grupos g on g.id = s.grupo_id
        where s.ciclo_id = ${act.id} and s.id_excel = $1 and s.id <> $2
          and s.plantel is not distinct from $3
        limit 1`, [idExcel, slotId, info.plantel]);
    if (dup)
      return { error: `El ID ${idExcel} ya lo usa "${dup.materia?.trim() || "otra clase"}"${dup.grupo ? ` · ${dup.grupo}` : ""} en este plantel. El ID puede repetirse entre planteles, pero no dentro del mismo.` };
  }

  const antes = await snapSlotIdExcel(slotId);   // foto SOLO del campo que esta acción toca
  await q(`update slots set id_excel=$1 where id=$2 and ciclo_id=${act.id}`, [idExcel, slotId]);
  await registrarCambio({
    entidad: "clase",
    entidadId: slotId,
    accion: "editó",
    descripcion: `Cambió el ID de "${info.materia ?? "clase"}"${info.grupo ? ` · ${info.grupo}` : ""}: ${info.id_excel ?? "sin ID"} → ${idExcel ?? "sin ID"}`,
    antes,
    despues: { kind: "row", tabla: "slots", clave: { id: slotId }, campos: { id_excel: idExcel } },
  });
  revalidatePath(`/asignacion/${slotId}`);
  revalidatePath("/asignacion");
  return { ok: idExcel == null ? "ID borrado." : `ID cambiado a ${idExcel}.` };
}

// ¿Cuántas clases llevan esta materia? (en TODOS los ciclos: renombrar también toca el historial).
// Lo usa la lista para avisar el alcance ANTES de confirmar un renombrado.
export async function usoMateria(materiaId: number): Promise<{ clases: number; nombre: string | null }> {
  await exigirSesionActiva();
  const [r] = await q<{ clases: number; nombre: string | null }>(
    `select (select count(*)::int from slots where materia_id=$1) clases,
            (select nombre from materias where id=$1) nombre`, [materiaId]);
  return r ?? { clases: 0, nombre: null };
}

// Corrige el NOMBRE de una materia en el catálogo. A diferencia de editarMateriaSlot, esto
// afecta a TODAS las clases que la llevan (mayo y septiembre) y a las candidaturas ligadas.
// El nombre se normaliza (mayúsculas, espacios simples) para mantener el catálogo uniforme.
export async function renombrarMateria(materiaId: number, nombreNuevo: string): Promise<EditarClaseState> {
  await exigirSesionActiva();
  const nombre = nombreNuevo.replace(/\s+/g, " ").trim().toUpperCase();
  if (!nombre) return { error: "El nombre no puede quedar vacío." };

  const [actual] = await q<{ nombre: string }>("select nombre from materias where id=$1", [materiaId]);
  if (!actual) return { error: "Esa materia no existe en el catálogo." };
  if (actual.nombre === nombre) return { ok: "Sin cambios." };

  // Si ya existe otra materia con ese nombre, renombrar crearía un duplicado disfrazado.
  // Lo correcto en ese caso es re-elegir la materia existente en cada clase, no renombrar.
  const slug = slugify(nombre);
  const [choque] = await q<{ nombre: string }>(
    "select nombre from materias where (lower(nombre)=lower($1) or slug=$2) and id<>$3", [nombre, slug, materiaId]);
  if (choque) {
    return { error: `Ya existe la materia "${choque.nombre}". Si esta clase debía llevar esa, usa "cambiar materia" y elígela de la lista.` };
  }

  const [uso] = await q<{ n: number }>("select count(*)::int n from slots where materia_id=$1", [materiaId]);
  const antes = await snapMateria(materiaId);
  await q("update materias set nombre=$1, slug=$2 where id=$3", [nombre, slug, materiaId]);
  await registrarCambio({
    entidad: "materia",
    entidadId: materiaId,
    accion: "editó",
    descripcion: `Renombró la materia "${actual.nombre}" → "${nombre}" (${uso.n} clase${uso.n === 1 ? "" : "s"} afectada${uso.n === 1 ? "" : "s"}, incluye historial)`,
    antes,
    despues: await snapMateria(materiaId),
  });
  await recalcularAlertas();   // los textos de las alertas citan el nombre de la materia
  revalidatePath("/asignacion");
  revalidatePath("/alertas");
  revalidatePath("/profesores");
  revalidatePath("/");
  return { ok: `Materia renombrada a "${nombre}" (${uso.n} clases actualizadas).` };
}

// Marca una clase como "No se apertura": se oculta de la lista de trabajo y de los conteos,
// el motor deja de asignarla y no genera alertas. NO borra nada: es reversible (Reactivar).
// A diferencia de eliminarSlot, conserva la asignación por si se reactiva más adelante.
export async function marcarNoApertura(slotId: number): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: los ciclos de historial son solo lectura
  if (bloqueo) return { error: bloqueo };
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
export async function reactivarSlot(slotId: number): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: los ciclos de historial son solo lectura
  if (bloqueo) return { error: bloqueo };
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
export async function eliminarSlot(slotId: number): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: los ciclos de historial son solo lectura
  if (bloqueo) return { error: bloqueo };
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

// Crea un GRUPO nuevo con el constructor de clave: la clave NUNCA se teclea, se arma por
// partes (plan → prefijo, número, turno, plantel → campus, subdivisión opcional). Cada parte
// se valida contra el catálogo real — así no pueden nacer variantes con dedazo ("ELE", "TC.").
export async function crearGrupo(datos: {
  planId: number;
  numero: number;
  turnoCodigo: string;
  plantel: string;
  subdivision?: string;
  cuatrimestre?: string;
  alumnos?: number | null;
}): Promise<{ ok: true; id: number; clave: string } | { ok: false; error: string }> {
  await exigirSesionActiva();

  if (!Number.isInteger(datos.numero) || datos.numero < 1 || datos.numero > 999)
    return { ok: false, error: "El número de grupo debe ser un entero entre 1 y 999." };
  const sub = (datos.subdivision ?? "").trim().toUpperCase();
  if (!["", "A", "B"].includes(sub))
    return { ok: false, error: "La subdivisión solo puede ser A o B (o ninguna)." };
  const cuatri = (datos.cuatrimestre ?? "").trim() || null;
  if (cuatri && !/^[1-9]°$/.test(cuatri))
    return { ok: false, error: "Cuatrimestre no válido (1° a 9°)." };
  const alumnos = datos.alumnos ?? null;
  if (alumnos != null && (!Number.isInteger(alumnos) || alumnos < 0 || alumnos > 1000))
    return { ok: false, error: "El número de alumnos debe ser un entero entre 0 y 1000." };

  // Prefijo del plan: el DOMINANTE en los datos reales (no se inventa ni se teclea).
  const [plan] = await q<{ id: number; nombre: string; prefijo: string | null }>(
    `select p.id, p.nombre,
            (select split_part(g.clave,'_',1) from grupos g
              where g.plan_id = p.id and g.clave is not null
              group by 1 order by count(*) desc, 1 limit 1) prefijo
       from planes p where p.id = $1`, [datos.planId]);
  if (!plan) return { ok: false, error: "Esa carrera no existe." };
  if (!plan.prefijo) return { ok: false, error: "Esa carrera no tiene grupos previos: no hay prefijo de clave que reutilizar. Avísame para definirlo." };

  // Turno: solo códigos con uso real (3+ grupos); los raros son typos históricos.
  const turnosOk = await q<{ codigo: string }>(
    `select split_part(clave,'_',3) codigo from grupos
      where clave is not null and array_length(string_to_array(clave,'_'),1) >= 4
      group by 1 having count(*) >= 3`);
  const turno = datos.turnoCodigo.trim().toUpperCase();
  if (!turnosOk.some((t) => t.codigo === turno))
    return { ok: false, error: "Ese código de turno no está en el catálogo." };

  // Campus: el código dominante del plantel elegido (CB gana sobre "TC."/"TEC").
  const [camp] = await q<{ campus: string }>(
    `select (string_to_array(g.clave,'_'))[array_length(string_to_array(g.clave,'_'),1)] campus
       from slots s join grupos g on g.id = s.grupo_id
      where g.clave is not null and s.plantel = $1
      group by campus order by count(*) desc limit 1`, [datos.plantel]);
  if (!camp) return { ok: false, error: "Ese plantel no existe en los datos (o no tiene grupos para deducir su código de campus)." };

  const clave = `${plan.prefijo}_G${datos.numero}_${turno}${sub ? `_${sub}` : ""}_${camp.campus}`;

  // Duplicado: además del UNIQUE de la base, avisamos bonito y sugerimos el siguiente libre.
  const [dup] = await q<{ id: number }>("select id from grupos where clave=$1", [clave]);
  if (dup) {
    const usados = await q<{ clave: string }>(
      `select clave from grupos where clave like $1`, [`${plan.prefijo}\\_G%\\_${turno}${sub ? `\\_${sub}` : ""}\\_${camp.campus}`]);
    const nums = usados.map((u) => Number(u.clave.split("_")[1]?.replace(/^G/, ""))).filter(Number.isFinite);
    const sig = nums.length ? Math.max(...nums) + 1 : 1;
    return { ok: false, error: `El grupo ${clave} ya existe. El siguiente número libre para esa combinación es G${sig}.` };
  }

  // Carrera check-then-insert: si dos personas crean la misma clave a la vez, el UNIQUE de
  // la base atrapa al segundo — aquí lo traducimos a un mensaje claro (no error crudo).
  let nuevo: { id: number };
  try {
    [nuevo] = await q<{ id: number }>(
      `insert into grupos (clave, plan_id, cuatrimestre, alumnos) values ($1,$2,$3,$4) returning id`,
      [clave, plan.id, cuatri, alumnos]);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505")
      return { ok: false, error: `El grupo ${clave} se acaba de crear (quizá otra persona al mismo tiempo). Ciérrate del constructor y elígelo de la lista.` };
    return { ok: false, error: `No se pudo crear el grupo: ${e instanceof Error ? e.message : "error desconocido"}` };
  }
  await registrarCambio({
    entidad: "grupo",
    entidadId: nuevo.id,
    accion: "creó",
    descripcion: `Creó el grupo ${clave} (${plan.nombre}${cuatri ? ` · ${cuatri}` : ""}${alumnos != null ? ` · ${alumnos} alumnos` : ""}, ${datos.plantel})`,
    despues: { id: nuevo.id, clave, plan_id: plan.id, cuatrimestre: cuatri, alumnos },
  });
  revalidatePath("/asignacion/nueva");
  revalidatePath("/asignacion");
  return { ok: true, id: nuevo.id, clave };
}

export type CrearSlotState = { error?: string };

// Crea una materia por grupo nueva en el ciclo activo (el que está seleccionado en el header).
// La materia y el grupo se reutilizan si ya existen (por nombre/clave); si no, se crean.
export async function crearSlot(_prev: CrearSlotState, fd: FormData): Promise<CrearSlotState> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: no se crean clases en un ciclo cerrado
  if (bloqueo) return { error: bloqueo };
  const plantel = String(fd.get("plantel") ?? "").trim();
  const materiaNombre = String(fd.get("materia") ?? "").trim();
  const grupoIdRaw = String(fd.get("grupo_id") ?? "").trim();
  const tipo = String(fd.get("tipo") ?? "").trim() || null;
  const modalidad = String(fd.get("modalidad") ?? "").trim() || null;
  // Mayúsculas: los slots guardan "LUNES" y la detección de choques compara el día como texto.
  const dia = String(fd.get("dia") ?? "").trim().toUpperCase() || null;
  const cuatrimestre = String(fd.get("cuatrimestre") ?? "").trim() || null;
  const hi = limpiarHora(String(fd.get("hora_inicio") ?? ""));
  const hf = limpiarHora(String(fd.get("hora_fin") ?? ""));

  if (!plantel) return { error: "Elige un plantel." };
  if (!materiaNombre) return { error: "Escribe el nombre de la materia." };
  // Un rango invertido o de duración cero escapa a la detección de choques (nunca "traslapa"
  // con nada), escondiendo empalmes reales de docente y de aula. Se rechaza en la captura.
  if (hi && hf && hi >= hf)
    return { error: `El horario está invertido o vacío (${hi}–${hf}): la hora de inicio debe ser antes que la de fin.` };
  // Coherencia con TODAS las demás materias (regla sin excepciones en los datos):
  // VIRTUAL ⇔ ASINCRÓNICA y sin horario; los demás tipos son PRESENCIALES.
  if (tipo === "VIRTUAL" && modalidad !== "ASINCRÓNICA")
    return { error: "Las clases VIRTUALES son asincrónicas (así están todas las demás). Cambia la modalidad a ASINCRÓNICA." };
  if (tipo !== "VIRTUAL" && modalidad === "ASINCRÓNICA")
    return { error: "Solo las clases VIRTUALES son asincrónicas. Si esta clase no tiene hora fija por diseño, su tipo debe ser VIRTUAL; si no, usa PRESENCIAL." };
  if (tipo === "VIRTUAL" && (dia || hi || hf))
    return { error: "Las clases VIRTUALES no llevan día ni hora (asincrónicas, como todas las demás). Deja el horario vacío." };

  // Grupo (opcional) PRIMERO: si el grupo va a fallar, que falle antes de tocar el catálogo
  // de materias (si no, una materia nueva quedaba creada y huérfana aunque la acción errara).
  // SOLO del catálogo, por id: ya no se crean grupos desde aquí con texto libre (era la puerta
  // de los dedazos tipo "TC."/"ELE"); los nuevos se arman con el constructor ("+ Nuevo grupo").
  let grupoId: number | null = null;
  let grupoClave: string | null = null;
  if (grupoIdRaw) {
    const gid = Number(grupoIdRaw);
    const [grupo] = Number.isInteger(gid)
      ? await q<{ id: number; clave: string }>("select id, clave from grupos where id=$1", [gid])
      : [];
    if (!grupo) return { error: "Ese grupo no existe en el catálogo. Elígelo de la lista o créalo con «+ Nuevo grupo»." };
    // Coherencia plantel ⇔ campus de la clave (mismo candado que la edición inline).
    const errCampus = await validarGrupoDelPlantel(grupo.clave, plantel);
    if (errCampus) return { error: errCampus };
    grupoId = grupo.id;
    grupoClave = grupo.clave;
  }

  // Materia: reutiliza por nombre (case-insensitive) o crea una nueva.
  let [materia] = await q<{ id: number }>(
    "select id from materias where lower(nombre)=lower($1)", [materiaNombre]);
  if (!materia) {
    [materia] = await q<{ id: number }>(
      "insert into materias (nombre, slug) values ($1,$2) returning id",
      [materiaNombre, slugify(materiaNombre)]);
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
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { ok: false, error: bloqueo };

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
    // Mayúsculas: los slots guardan "LUNES"; un "Lunes" no empataría en la detección de choques.
    const dia = opts.horario.dia?.trim().toUpperCase();
    const hi = limpiarHora(opts.horario.hora_inicio ?? "");
    const hf = limpiarHora(opts.horario.hora_fin ?? "");
    if (!dia || !hi || !hf)
      return { ok: false, error: "El horario elegido no es válido (día y hora inicio–fin en formato HH:MM)." };
    horarioAplicar = { dia, hi, hf };
  } else if (firmas.length > 1) {
    return { ok: false, error: "Los grupos están en horarios distintos. Elige a qué día y hora quedará la clase compactada." };
  }

  const docenteId = opts.docenteId ?? null;
  const efDia = horarioAplicar?.dia ?? filas[0].dia;
  const efHi = horarioAplicar?.hi ?? filas[0].hora_inicio;
  const efHf = horarioAplicar?.hf ?? filas[0].hora_fin;

  // Escritura atómica: contenedor + ligar slots + (opcional) homogeneizar horario y asignar docente.
  let nuevoId: number;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const exec = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows as T[]);
    // Choque del docente (si se asigna desde aquí): no debe encimar con OTRAS clases suyas a esa
    // hora. El chequeo va DENTRO de la transacción y tras el MISMO candado por docente que usa
    // asignar(): dos coordinadores tocando al mismo docente a la vez se serializan aquí; el
    // check-then-insert no puede pasar dos veces "en paralelo" y dejarlo doble-reservado.
    if (docenteId) {
      await exec("select pg_advisory_xact_lock(492813475, $1::int)", [docenteId]);
      if (efDia && efHi && efHf) {
        const [choque] = await exec<{ mat: string }>(
          `select coalesce(m2.nombre,'otra clase') || coalesce(' · ' || g2.clave,'') mat
             from asignaciones a2 join slots s2 on s2.id=a2.slot_id
             left join materias m2 on m2.id=s2.materia_id
             left join grupos g2 on g2.id=s2.grupo_id
            where a2.profesor_id=$1 and s2.ciclo_id=${act.id} and s2.id <> all($2)
              and not s2.no_apertura
              and s2.dia=$3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
              and ${sqlMismoPeriodo("$6", "s2.tipo")}
            order by s2.hora_inicio limit 1`,
          [docenteId, ids, efDia, efHi, efHf, filas[0].tipo]);
        if (choque) throw new Error(`el docente elegido ya da "${choque.mat}" a esa hora: no se puede asignar a la clase compactada sin empalmarlo.`);
      }
    }
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
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { ok: false, error: bloqueo };
  // Solo compactaciones del ciclo activo: una pantalla vieja apuntando a otro ciclo no muta nada.
  const [c] = await q<{ id: number; materia: string | null; plantel: string | null }>(
    `select c.id, m.nombre materia, c.plantel from compactaciones c left join materias m on m.id=c.materia_id where c.id=$1 and c.ciclo_id=${act.id}`, [compactacionId]);
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

// Crea OTRA materia para TODOS los grupos de una clase compactada, y la deja compactada
// también (una sola clase nueva: un docente, un horario). Caso de uso: al fusionar grupos
// chicos, los alumnos cursan juntos VARIAS materias — esta acción evita crearlas grupo por
// grupo y volverlas a compactar a mano. Nace sin docente (se asigna con el flujo normal,
// que ya valida choques). Todo por catálogo: materia y tipo son selección estricta.
export async function agregarMateriaAClaseCompactada(
  compactacionId: number,
  datos: { materiaId: number; tipo: string; horario?: { dia: string; hora_inicio: string; hora_fin: string } | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await exigirSesionActiva();
  const act = await cicloActivo();
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { ok: false, error: bloqueo };

  if (!Number.isFinite(datos.materiaId)) return { ok: false, error: "Elige la materia del catálogo." };
  const [mat] = await q<{ id: number; nombre: string }>("select id, nombre from materias where id=$1", [datos.materiaId]);
  if (!mat) return { ok: false, error: "Esa materia no existe en el catálogo." };
  if (!TIPOS_CLASE.includes(datos.tipo)) return { ok: false, error: "Tipo de clase no válido." };

  const [cont] = await q<{ id: number; plantel: string | null; materia: string | null }>(
    `select c.id, c.plantel, m.nombre materia from compactaciones c
       left join materias m on m.id = c.materia_id where c.id=$1 and c.ciclo_id=${act.id}`, [compactacionId]);
  if (!cont) return { ok: false, error: "Esa compactación ya no existe (quizá se separó). Recarga la pantalla." };
  if (mat.nombre === cont.materia)
    return { ok: false, error: `La clase compactada ya ES de "${mat.nombre}". Elige la otra materia que van a cursar estos grupos.` };

  // Un slot por grupo miembro (con el cuatrimestre de su clase original).
  const miembros = await q<{ grupo_id: number; grupo: string; cuatrimestre: string | null }>(
    `select distinct on (s.grupo_id) s.grupo_id, g.clave grupo, s.cuatrimestre
       from slots s join grupos g on g.id = s.grupo_id
      where s.compactacion_id=$1 and s.ciclo_id=${act.id} and s.grupo_id is not null
      order by s.grupo_id, s.id`, [compactacionId]);
  if (miembros.length === 0) return { ok: false, error: "La clase compactada no tiene grupos identificables. Recarga la pantalla." };

  // Coherencia con TODAS las demás materias (regla sin excepciones en los datos):
  // VIRTUAL ⇔ ASINCRÓNICA, sin horario y sin aula; el resto es PRESENCIAL.
  const modalidad = datos.tipo === "VIRTUAL" ? "ASINCRÓNICA" : "PRESENCIAL";
  if (datos.tipo === "VIRTUAL" && datos.horario)
    return { ok: false, error: "Las clases VIRTUALES son asincrónicas: no llevan día ni hora (así están todas las demás). Deja el horario vacío." };

  // Horario opcional; si viene, completo y válido (mismas reglas que editarHorario).
  let dia: string | null = null, hi: string | null = null, hf: string | null = null;
  if (datos.horario) {
    // Mayúsculas: los slots guardan "MARTES"; un "Martes" no empataría en la detección de choques.
    dia = datos.horario.dia?.trim().toUpperCase() || null;
    hi = limpiarHora(datos.horario.hora_inicio ?? "");
    hf = limpiarHora(datos.horario.hora_fin ?? "");
    if (!dia || !hi || !hf) return { ok: false, error: "El horario está incompleto: captura día y hora inicio–fin (HH:MM), o déjalo todo vacío." };
    if (hi >= hf) return { ok: false, error: `El horario está invertido o vacío (${hi}–${hf}): la hora de inicio debe ser antes que la de fin.` };
  }

  // Escritura atómica: contenedor nuevo + un slot por grupo (ya ligados) + alertas.
  let nuevaCompId: number;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const exec = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows as T[]);
    // Candado por compactación + anti-duplicado DENTRO de la transacción: dos pestañas
    // creando la misma materia a la vez se serializan aquí; sin esto, ambas pasaban el
    // chequeo y nacían dos clases gemelas con slots duplicados por grupo.
    await exec("select pg_advisory_xact_lock(492813476, $1::int)", [compactacionId]);
    const yaLaLlevan = await exec<{ clave: string }>(
      `select g.clave from slots s join grupos g on g.id = s.grupo_id
        where s.ciclo_id=${act.id} and s.grupo_id = any($1)
          and s.materia_id = $2 and s.tipo is not distinct from $3`,
      [miembros.map((m) => m.grupo_id), mat.id, datos.tipo]);
    if (yaLaLlevan.length)
      throw new Error(`estos grupos ya llevan "${mat.nombre}" (${datos.tipo}) en este ciclo: ${yaLaLlevan.map((r) => r.clave).join(", ")}. No se crea un duplicado.`);
    const { rows: [comp] } = await client.query<{ id: number }>(
      `insert into compactaciones (ciclo_id, materia_id, plantel, razon) values ($1,$2,$3,$4) returning id`,
      [act.id, mat.id, cont.plantel, `Materia agregada a los grupos compactados de "${cont.materia ?? "otra clase"}"`]);
    nuevaCompId = comp.id;
    await client.query(
      `insert into slots (plantel, ciclo, ciclo_id, es_historial, grupo_id, materia_id, cuatrimestre, tipo, modalidad, dia, hora_inicio, hora_fin, compactacion_id)
       select $1, $2, $3, false, t.g, $4, t.cuatri, $5, $6, $7, $8, $9, $10
         from unnest($11::int[], $12::text[]) as t(g, cuatri)`,
      [cont.plantel, act.codigo, act.id, mat.id, datos.tipo, modalidad, dia, hi, hf, nuevaCompId,
       miembros.map((m) => m.grupo_id), miembros.map((m) => m.cuatrimestre)]);
    await recomputarAlertas((sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows), act.id);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return { ok: false, error: `No se pudo crear la materia: ${e instanceof Error ? e.message : "error desconocido"}` };
  } finally {
    client.release();
  }

  const grupos = miembros.map((m) => m.grupo).join(", ");
  await registrarCambio({
    entidad: "compactacion",
    entidadId: nuevaCompId,
    accion: "creó",
    descripcion: `Creó "${mat.nombre}" (${datos.tipo}) para los ${miembros.length} grupos de la clase compactada de "${cont.materia ?? "otra materia"}"${cont.plantel ? ` (${cont.plantel})` : ""}: ${grupos}${dia ? ` · ${dia} ${hi}–${hf}` : " · sin horario"}`,
    despues: { id: nuevaCompId, desdeCompactacion: compactacionId, materiaId: mat.id, tipo: datos.tipo, grupos: miembros.map((m) => m.grupo_id), dia, hora_inicio: hi, hora_fin: hf },
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
export async function marcarChico(grupoId: number, valor: boolean): Promise<{ error: string } | void> {
  await exigirSesionActiva();
  // Candado de ciclo: el dato vive en `grupos` (no por ciclo), así que editarlo desde una
  // vista de historial afectaría al cuatrimestre en planeación sin que se vea. Se bloquea
  // igual que el resto de la edición: para cambiarlo, cambia al ciclo en planeación.
  const bloqueo = motivoCicloSoloLectura(await cicloActivo());
  if (bloqueo) return { error: bloqueo };
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
  // Candado de ciclo: igual que marcarChico, el dato es del grupo y afecta a todos los ciclos.
  const bloqueo = motivoCicloSoloLectura(await cicloActivo());
  if (bloqueo) return { ok: false, error: bloqueo };
  const nuevo: number | null = valor;
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
  // El número de alumnos alimenta la alerta "ningún salón alcanza" (severidad y texto):
  // sin recálculo, /alertas mostraría el diagnóstico viejo hasta la siguiente acción.
  await recalcularAlertas();
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
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { ok: false, error: bloqueo };

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

  const efDia = base.dia, efHi = base.hora_inicio, efHf = base.hora_fin;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const exec = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows as T[]);
    // Choque del docente de la clase contra OTRAS clases suyas a esa hora (excluye la propia
    // clase y los nuevos). DENTRO de la transacción y tras el candado por docente (mismo patrón
    // que asignar/compactar): así no puede colarse una asignación concurrente entre el check
    // y la escritura.
    if (docenteClase) {
      await exec("select pg_advisory_xact_lock(492813475, $1::int)", [docenteClase]);
      if (efDia && efHi && efHf) {
        const excluir = [...new Set([...ids, ...miembros.map((m) => m.id)])];
        const [choque] = await exec<{ mat: string }>(
          `select coalesce(m2.nombre,'otra clase') || coalesce(' · ' || g2.clave,'') mat
             from asignaciones a2 join slots s2 on s2.id=a2.slot_id
             left join materias m2 on m2.id=s2.materia_id
             left join grupos g2 on g2.id=s2.grupo_id
            where a2.profesor_id=$1 and s2.ciclo_id=${act.id} and s2.id <> all($2)
              and not s2.no_apertura
              and s2.dia=$3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
              and ${sqlMismoPeriodo("$6", "s2.tipo")}
            order by s2.hora_inicio limit 1`,
          [docenteClase, excluir, efDia, efHi, efHf, base.tipo]);
        if (choque) throw new Error(`el docente de la clase ya da "${choque.mat}" a esa hora: no se puede agregar este grupo sin empalmarlo.`);
      }
    }
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
  const bloqueo = motivoCicloSoloLectura(act);   // candado: historial es solo lectura
  if (bloqueo) return { ok: false, error: bloqueo };

  const [c] = await q<{ id: number; materia: string | null; plantel: string | null }>(
    `select c.id, m.nombre materia, c.plantel from compactaciones c left join materias m on m.id=c.materia_id where c.id=$1 and c.ciclo_id=${act.id}`,
    [compactacionId]);
  if (!c) return { ok: false, error: "Esa compactación ya no existe (quizá se separó)." };

  // Mayúsculas: los slots guardan "LUNES"; un "Lunes" no empataría en la detección de choques.
  const dia = horario.dia?.trim().toUpperCase();
  const hi = limpiarHora(horario.hora_inicio ?? "");
  const hf = limpiarHora(horario.hora_fin ?? "");
  if (!dia || !hi || !hf) return { ok: false, error: "El horario elegido no es válido (día y hora inicio–fin en formato HH:MM)." };

  const miembros = await q<{ id: number; profesor_id: number | null; tipo: string | null }>(
    `select s.id, a.profesor_id, s.tipo from slots s left join asignaciones a on a.slot_id=s.id where s.compactacion_id=$1 and s.ciclo_id=${act.id}`,
    [compactacionId]);
  if (miembros.length === 0) return { ok: false, error: "La clase compactada no tiene grupos. Recarga la pantalla." };
  const ids = miembros.map((m) => m.id);

  const profes = [...new Set(miembros.map((m) => m.profesor_id).filter((x): x is number => x != null))].sort((a, b) => a - b);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const exec = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      client.query(sql, params).then((r) => r.rows as T[]);
    // Choque de cada docente de la clase contra OTRAS clases suyas (fuera de esta compactación)
    // a ese horario. DENTRO de la transacción, tras el candado por docente (mismo patrón que
    // asignar/compactar). Los candados se toman en orden ascendente para no interbloquearse
    // con otra operación que toque a los mismos docentes.
    for (const prof of profes) await exec("select pg_advisory_xact_lock(492813475, $1::int)", [prof]);
    for (const prof of profes) {
      const [choque] = await exec<{ mat: string }>(
        `select coalesce(m2.nombre,'otra clase') || coalesce(' · ' || g2.clave,'') mat
           from asignaciones a2 join slots s2 on s2.id=a2.slot_id
           left join materias m2 on m2.id=s2.materia_id
           left join grupos g2 on g2.id=s2.grupo_id
          where a2.profesor_id=$1 and s2.ciclo_id=${act.id} and s2.id <> all($2)
            and not s2.no_apertura
            and s2.dia=$3 and s2.hora_inicio < $5 and $4 < s2.hora_fin
            and ${sqlMismoPeriodo("$6", "s2.tipo")}
          order by s2.hora_inicio limit 1`,
        [prof, ids, dia, hi, hf, miembros[0].tipo]);
      if (choque) throw new Error(`un docente de la clase ya da "${choque.mat}" a esa hora: elige otro horario para no empalmarlo.`);
    }
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
