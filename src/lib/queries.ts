import { q } from "./db";

// "Docentes" del Excel que no son personas (no asignables).
export const PLACEHOLDERS = ["CAMBIO DE TURNO", "DOCENTE NUEVO", "NO SE APERTURA", "NOSE APERTURA"];

export async function getResumen() {
  const [r] = await q<{
    sep_total: number; asignados: number; confirmados: number; sugeridos: number;
    cvs: number; profes: number; materias: number;
  }>(`select
        (select count(*) from slots where es_historial=false)::int sep_total,
        (select count(*) from asignaciones where profesor_id is not null)::int asignados,
        (select count(*) from asignaciones where estado='confirmada')::int confirmados,
        (select count(*) from asignaciones where estado='sugerida' and profesor_id is not null)::int sugeridos,
        (select count(*) from cv_competencias)::int cvs,
        (select count(*) from profesores)::int profes,
        (select count(*) from materias)::int materias`);
  const alertas = await q<{ tipo: string; n: number }>(
    "select tipo, count(*)::int n from alertas group by tipo");
  return { ...r, alertas };
}

// Lista de TODOS los profesores (los del Excel + los dados de alta). Filtro opcional por CV.
export async function getProfesores(cv: "" | "cv" | "sincv" = "", coordinador = "") {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (cv === "cv") conds.push("exists(select 1 from cv_competencias c where c.profesor_id=p.id)");
  else if (cv === "sincv") conds.push("not exists(select 1 from cv_competencias c where c.profesor_id=p.id)");
  if (coordinador) { params.push(coordinador); conds.push(`p.coordinador = $${params.length}`); }
  const where = conds.length ? `where ${conds.join(" and ")}` : "";
  return q<{
    id: number; nombre: string; anios_experiencia: number | null;
    licenciatura: string | null; coordinador: string | null; tiene_cv: boolean; n_cand: number; n_asig: number;
    planteles: string | null;
  }>(
    `select p.id, p.nombre, p.anios_experiencia, p.licenciatura, p.coordinador,
            exists(select 1 from cv_competencias c where c.profesor_id=p.id) tiene_cv,
            (select count(*) from materia_candidatos mc where mc.profesor_id=p.id)::int n_cand,
            (select count(*) from asignaciones a where a.profesor_id=p.id)::int n_asig,
            (select string_agg(distinct pl, ',') from (
               select s.plantel pl from slots s where s.es_historial and s.docente_id = p.id
               union
               select s2.plantel from asignaciones a join slots s2 on s2.id = a.slot_id where a.profesor_id = p.id
             ) x where pl is not null) planteles
       from profesores p ${where}
      order by p.nombre`, params);
}

export async function getProfesoresConteo() {
  const [r] = await q<{ total: number; con_cv: number }>(
    `select count(*)::int total,
            count(*) filter (where exists(select 1 from cv_competencias c where c.profesor_id=p.id))::int con_cv
       from profesores p`);
  return r;
}

export async function getProfesor(id: number) {
  const [prof] = await q<{
    id: number; nombre: string; licenciatura: string | null; maestria: string | null;
    doctorado: string | null; area_cv: string | null; anios_experiencia: number | null; cv_archivo: string | null;
    coordinador: string | null; payload: Record<string, unknown> | null; modelo: string | null;
  }>(
    `select p.id, p.nombre, p.licenciatura, p.maestria, p.doctorado, p.area_cv, p.anios_experiencia, p.cv_archivo,
            p.coordinador, c.payload, c.modelo
       from profesores p left join cv_competencias c on c.profesor_id = p.id
      where p.id = $1`, [id]);
  if (!prof) return null;
  const candidatas = await q<{ materia_id: number; fuente: string; puntaje: number; razon: string; materia: string }>(
    `select mc.materia_id, mc.fuente, mc.puntaje, mc.razon, m.nombre materia
       from materia_candidatos mc join materias m on m.id = mc.materia_id
      where mc.profesor_id = $1 order by mc.puntaje desc, m.nombre`, [id]);
  const asignaciones = await q<{
    slot_id: number; materia: string; grupo: string | null; plantel: string | null; dia: string | null;
    hora_inicio: string | null; hora_fin: string | null; tipo: string | null; estado: string;
  }>(
    `select s.id slot_id, m.nombre materia, g.clave grupo, s.plantel, s.dia, s.hora_inicio, s.hora_fin, s.tipo, a.estado
       from asignaciones a join slots s on s.id = a.slot_id
       join materias m on m.id = s.materia_id left join grupos g on g.id = s.grupo_id
      where a.profesor_id = $1 and a.profesor_id is not null order by s.plantel, s.dia, s.hora_inicio`, [id]);
  // Clases que YA dio (historial real de mayo): slots marcados es_historial con este docente.
  const historial = await q<{
    materia: string; grupo: string | null; plantel: string | null;
    cuatrimestre: string | null; tipo: string | null;
  }>(
    `select m.nombre materia, g.clave grupo, s.plantel, s.cuatrimestre, s.tipo
       from slots s join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
      where s.es_historial = true and s.docente_id = $1
      order by s.plantel, m.nombre`, [id]);
  // Grupos ABIERTOS (clases de septiembre sin docente) de las materias que este docente puede dar.
  // Sirve para asignarlo desde su propia ficha: al elegir una materia candidata, se ven los grupos
  // libres de esa materia. `choque` marca si el docente YA tiene otra clase encimada a ese día/hora
  // (mismo criterio de traslape que usamos en la pantalla de asignación y para las aulas).
  const gruposAbiertos = await q<{
    slot_id: number; materia_id: number; materia: string; grupo: string | null; plantel: string | null;
    dia: string | null; hora_inicio: string | null; hora_fin: string | null; tipo: string | null;
    modalidad: string | null; choque: string | null;
  }>(
    `select s.id slot_id, s.materia_id, m.nombre materia, g.clave grupo, s.plantel,
            s.dia, s.hora_inicio, s.hora_fin, s.tipo, s.modalidad,
            (select m2.nombre || coalesce(' · ' || g2.clave, '')
               from asignaciones a2
               join slots s2 on s2.id = a2.slot_id
               left join materias m2 on m2.id = s2.materia_id
               left join grupos g2 on g2.id = s2.grupo_id
              where a2.profesor_id = $1
                and s2.es_historial = false and s2.id <> s.id
                and s2.dia = s.dia and s2.hora_inicio < s.hora_fin and s.hora_inicio < s2.hora_fin
              order by s2.hora_inicio limit 1) choque
       from slots s
       join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false
        and a.profesor_id is null
        and s.materia_id in (select materia_id from materia_candidatos where profesor_id = $1)
      order by s.materia_id, s.plantel, s.dia, s.hora_inicio`, [id]);
  return { prof, candidatas, asignaciones, historial, gruposAbiertos };
}

export type SlotFiltro = { estado?: string; q?: string; plantel?: string; cuatri?: string; tipo?: string; page?: number };

// Planteles con materias por asignar (para el selector de la pantalla de asignación).
export async function getPlanteles() {
  const rows = await q<{ plantel: string; n: number }>(
    `select s.plantel, count(*)::int n from slots s
      where s.es_historial = false group by s.plantel order by s.plantel`);
  return rows;
}

// Opciones disponibles para los filtros de cuatrimestre y tipo, acotadas al plantel
// elegido (para no ofrecer filtros que no devolverían nada). Solo septiembre.
export async function getFacetasSlots(plantel?: string) {
  const params: unknown[] = [];
  let scope = "";
  if (plantel) { params.push(plantel); scope = ` and s.plantel = $${params.length}`; }
  const cuatris = await q<{ v: string }>(
    `select distinct s.cuatrimestre v from slots s
      where s.es_historial = false and s.cuatrimestre is not null${scope}`, params);
  const tipos = await q<{ v: string }>(
    `select distinct s.tipo v from slots s
      where s.es_historial = false and s.tipo is not null${scope}`, params);
  // Orden natural: cuatris por el número inicial (1°, 2°…); tipos alfabético.
  const ordenCuatri = (s: string) => parseInt(s, 10) || 99;
  return {
    cuatris: cuatris.map((r) => r.v).sort((a, b) => ordenCuatri(a) - ordenCuatri(b) || a.localeCompare(b)),
    tipos: tipos.map((r) => r.v).sort((a, b) => a.localeCompare(b)),
  };
}

// Conteos para el control segmentado (Todos / Sin docente / Con docente).
// Respeta plantel + búsqueda + cuatri + tipo, pero NO el estado: así cada segmento
// muestra cuántas clases caen en él dentro del resto de filtros activos.
export async function getConteoPorEstado(f: SlotFiltro) {
  const where: string[] = ["s.es_historial = false"];
  const params: unknown[] = [];
  if (f.plantel) { params.push(f.plantel); where.push(`s.plantel = $${params.length}`); }
  if (f.q) { params.push(`%${f.q}%`); where.push(`(m.nombre ilike $${params.length} or g.clave ilike $${params.length})`); }
  if (f.cuatri) { params.push(f.cuatri); where.push(`s.cuatrimestre = $${params.length}`); }
  if (f.tipo) { params.push(f.tipo); where.push(`s.tipo = $${params.length}`); }
  const [r] = await q<{ total: number; sin: number; con: number }>(
    `select count(*)::int total,
            count(*) filter (where a.profesor_id is null)::int sin,
            count(*) filter (where a.profesor_id is not null)::int con
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join asignaciones a on a.slot_id = s.id
      where ${where.join(" and ")}`, params);
  return r;
}

export async function getSlotsSeptiembre(f: SlotFiltro, limit = 100) {
  const where: string[] = ["s.es_historial = false"];
  const params: unknown[] = [];
  if (f.plantel) { params.push(f.plantel); where.push(`s.plantel = $${params.length}`); }
  if (f.q) { params.push(`%${f.q}%`); where.push(`(m.nombre ilike $${params.length} or g.clave ilike $${params.length})`); }
  if (f.cuatri) { params.push(f.cuatri); where.push(`s.cuatrimestre = $${params.length}`); }
  if (f.tipo) { params.push(f.tipo); where.push(`s.tipo = $${params.length}`); }
  if (f.estado === "asignado") where.push("a.profesor_id is not null");
  if (f.estado === "sin_asignar") where.push("a.profesor_id is null");
  // Paginación: limit por página + offset según la página pedida (1-based).
  const page = Math.max(1, f.page ?? 1);
  const offset = (page - 1) * limit;
  params.push(limit);
  const pLimit = params.length;
  params.push(offset);
  const pOffset = params.length;
  const rows = await q<{
    id: number; plantel: string; materia: string | null; grupo: string | null; dia: string | null;
    hora_inicio: string | null; hora_fin: string | null; tipo: string | null;
    plan: string | null; cuatrimestre: string | null; alumnos: number | null; aula: string | null;
    docente: string | null; estado: string | null; puntaje: number | null;
  }>(
    `select s.id, s.plantel, m.nombre materia, g.clave grupo, s.dia, s.hora_inicio, s.hora_fin, s.tipo,
            pl.nombre plan, s.cuatrimestre, g.alumnos, au.clave aula,
            p.nombre docente, a.estado, a.puntaje
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join planes pl on pl.id = g.plan_id
       left join aulas au on au.id = s.aula_id
       left join asignaciones a on a.slot_id = s.id
       left join profesores p on p.id = a.profesor_id
      where ${where.join(" and ")}
      order by (a.profesor_id is null) desc, m.nombre, g.clave, s.id
      limit $${pLimit} offset $${pOffset}`, params);
  const [tot] = await q<{ n: number }>(
    "select count(*)::int n from slots s left join materias m on m.id=s.materia_id left join grupos g on g.id=s.grupo_id left join asignaciones a on a.slot_id=s.id where " + where.join(" and "),
    params.slice(0, pLimit - 1));
  const pages = Math.max(1, Math.ceil(tot.n / limit));
  return { rows, total: tot.n, page, pages, limit };
}

// Cuántas sugerencias automáticas siguen sin revisar (estado 'sugerida', con docente),
// opcionalmente acotado a un plantel. Sirve para el botón "Confirmar todas las sugeridas".
export async function contarSugeridas(plantel?: string) {
  const params: unknown[] = [];
  let scope = "";
  if (plantel) { params.push(plantel); scope = ` and s.plantel = $${params.length}`; }
  const [r] = await q<{ n: number }>(
    `select count(*)::int n
       from asignaciones a
       join slots s on s.id = a.slot_id and s.es_historial = false
      where a.estado = 'sugerida' and a.profesor_id is not null${scope}`, params);
  return r.n;
}

export async function getSlot(id: number) {
  const [slot] = await q<{
    id: number; materia_id: number | null; materia: string | null; grupo: string | null;
    plantel: string | null;
    dia: string | null; hora_inicio: string | null; hora_fin: string | null; tipo: string | null;
    modalidad: string | null; cuatrimestre: string | null; plan: string | null;
    alumnos: number | null; aula_id: number | null; aula: string | null; aula_capacidad: number | null;
    docente_id: number | null; docente: string | null; estado: string | null;
    puntaje: number | null; razon: string | null;
  }>(
    `select s.id, s.materia_id, m.nombre materia, g.clave grupo, s.plantel, s.dia, s.hora_inicio, s.hora_fin,
            s.tipo, s.modalidad, s.cuatrimestre, pl.nombre plan, g.alumnos,
            s.aula_id, au.clave aula, au.capacidad aula_capacidad,
            a.profesor_id docente_id, p.nombre docente, a.estado, a.puntaje, a.razon
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join planes pl on pl.id = g.plan_id
       left join aulas au on au.id = s.aula_id
       left join asignaciones a on a.slot_id = s.id
       left join profesores p on p.id = a.profesor_id
      where s.id = $1`, [id]);
  if (!slot) return null;
  const candidatos = slot.materia_id ? await q<{
    profesor_id: number; nombre: string; puntaje: number; fuentes: string; razon: string; carga: number;
    hist_planteles: string | null; choque: string | null;
  }>(
    // `choque`: si el docente YA tiene otra clase de septiembre que se encima con el día/hora de
    // esta (subconsulta correlacionada). Si esta clase no tiene horario, la comparación da null y
    // no marca choque (no podemos saberlo). Mismo criterio de traslape que usamos para las aulas.
    `select mc.profesor_id, pr.nombre, sum(mc.puntaje)::int puntaje,
            string_agg(distinct mc.fuente, ',') fuentes,
            string_agg(mc.razon, ' | ' order by mc.puntaje desc) razon,
            (select count(*) from asignaciones a where a.profesor_id = mc.profesor_id)::int carga,
            (select string_agg(distinct s2.plantel, ',')
               from slots s2
              where s2.es_historial and s2.docente_id = mc.profesor_id
                and s2.materia_id = $1) hist_planteles,
            (select m2.nombre || coalesce(' · ' || g2.clave, '')
               from asignaciones a2
               join slots s2 on s2.id = a2.slot_id
               left join materias m2 on m2.id = s2.materia_id
               left join grupos g2 on g2.id = s2.grupo_id
              where a2.profesor_id = mc.profesor_id
                and s2.es_historial = false and s2.id <> $3
                and s2.dia = $4 and s2.hora_inicio < $6 and $5 < s2.hora_fin
              order by s2.hora_inicio limit 1) choque
       from materia_candidatos mc join profesores pr on pr.id = mc.profesor_id
      where mc.materia_id = $1 and mc.puntaje >= 25 and pr.nombre <> all($2)
      group by mc.profesor_id, pr.nombre
      order by puntaje desc, pr.nombre limit 8`,
    [slot.materia_id, PLACEHOLDERS, id, slot.dia, slot.hora_inicio, slot.hora_fin]) : [];

  // Reordena: primero los LIBRES a esa hora (sin choque), luego quien ya dio la materia EN ESTE
  // plantel (fit más natural), luego por puntaje. Un choque no lo descarta —coordinación decide—
  // pero lo manda al fondo para que no se asigne por accidente.
  const enEstePlantel = (hp: string | null) =>
    !!slot.plantel && !!hp && hp.split(",").includes(slot.plantel);
  candidatos.sort((a, b) =>
    Number(!!a.choque) - Number(!!b.choque) ||
    Number(enEstePlantel(b.hist_planteles)) - Number(enEstePlantel(a.hist_planteles)) ||
    b.puntaje - a.puntaje);

  // Candidatos de aula: salones que alcanzan para el grupo, libres primero (sin choque a esa hora).
  // Solo aplica a clases presenciales; las virtuales no ocupan salón.
  const aulas = (slot.modalidad || "").toUpperCase() === "PRESENCIAL"
    ? await q<{ id: number; clave: string; tipo: string | null; capacidad: number | null; ocupada: boolean }>(
      `select au.id, au.clave, au.tipo, au.capacidad,
              exists(
                select 1 from slots s2
                 where s2.es_historial = false and s2.aula_id = au.id and s2.id <> $1
                   and s2.dia = $2 and s2.hora_inicio < $4 and $3 < s2.hora_fin
              ) ocupada
         from aulas au
        where au.id = $6                                              -- el salón ya asignado SIEMPRE aparece
           or (au.capacidad is not null and ($5::int is null or au.capacidad >= $5))
        order by (au.id = $6) desc, ocupada asc, (au.tipo = 'Teoría') desc, au.capacidad asc nulls last
        limit 9`,
      [id, slot.dia, slot.hora_inicio, slot.hora_fin, slot.alumnos, slot.aula_id])
    : [];
  return { slot, candidatos, aulas };
}

// Búsqueda libre de docentes para asignación manual (ignora puntaje/recomendación).
// Sirve cuando una materia no tiene candidato fuerte pero coordinación sabe a quién poner.
// Recibe el horario de la clase (slotId/día/hora) para marcar, igual que en los recomendados,
// si el docente ya tiene otra clase encimada a esa hora.
export async function buscarProfesores(
  texto: string, materiaId: number | null,
  slotId: number, dia: string | null, horaInicio: string | null, horaFin: string | null,
) {
  const t = texto.trim();
  const like = `%${t}%`;
  return q<{
    id: number; nombre: string; area_cv: string | null; carga: number;
    recomendado: boolean; choque: string | null;
  }>(
    `select p.id, p.nombre, p.area_cv,
            (select count(*) from asignaciones a where a.profesor_id = p.id)::int carga,
            exists(
              select 1 from materia_candidatos mc
               where mc.profesor_id = p.id and mc.materia_id = $2 and mc.puntaje >= 25
            ) recomendado,
            (select m2.nombre || coalesce(' · ' || g2.clave, '')
               from asignaciones a2
               join slots s2 on s2.id = a2.slot_id
               left join materias m2 on m2.id = s2.materia_id
               left join grupos g2 on g2.id = s2.grupo_id
              where a2.profesor_id = p.id
                and s2.es_historial = false and s2.id <> $5
                and s2.dia = $6 and s2.hora_inicio < $8 and $7 < s2.hora_fin
              order by s2.hora_inicio limit 1) choque
       from profesores p
      where p.nombre <> all($3)
        and ($1 = '' or p.nombre ilike $4 or coalesce(p.area_cv,'') ilike $4)
      order by p.nombre
      limit 25`,
    [t, materiaId, PLACEHOLDERS, like, slotId, dia, horaInicio, horaFin]);
}

export async function getMaterias() {
  return q<{ id: number; nombre: string }>("select id, nombre from materias order by nombre");
}

export async function getGrupos() {
  return q<{ id: number; clave: string }>(
    "select id, clave from grupos where clave is not null order by clave");
}

export async function getAulas() {
  // en_uso = nº de clases de septiembre que tienen asignada esta aula (para no borrar salones ocupados).
  const aulas = await q<{ id: number; clave: string; tipo: string | null; capacidad: number | null; en_uso: number }>(
    `select a.id, a.clave, a.tipo, a.capacidad,
            (select count(*)::int from slots s where s.aula_id = a.id and s.es_historial = false) en_uso
       from aulas a order by a.tipo, a.capacidad desc nulls last, a.clave`);
  const grupoMax = await q<{ alumnos_max: number; cap_teoria: number; cap_practica: number }>(
    `select coalesce(max(g.alumnos),0)::int alumnos_max,
            (select coalesce(max(capacidad),0)::int from aulas where tipo='Teoría') cap_teoria,
            (select coalesce(max(capacidad),0)::int from aulas where tipo='Práctica') cap_practica
       from grupos g`);
  // Aulas sin capacidad: el auto-acomodo NO puede usarlas (no sabe cuántos caben), así que las ignora.
  const sinCap = aulas.filter((a) => a.capacidad == null).length;
  return { aulas, resumen: { ...grupoMax[0], sin_capacidad: sinCap } };
}

export async function getAlertas(f: { tipo?: string; severidad?: string; plantel?: string } = {}) {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (f.tipo) { params.push(f.tipo); cond.push(`a.tipo = $${params.length}`); }
  if (f.severidad) { params.push(f.severidad); cond.push(`a.severidad = $${params.length}`); }
  if (f.plantel) { params.push(f.plantel); cond.push(`s.plantel = $${params.length}`); }
  const where = cond.length ? `where ${cond.join(" and ")}` : "";
  return q<{
    id: number; tipo: string; severidad: string; detalle: string;
    slot_id: number | null; profesor_id: number | null; profesor: string | null; plantel: string | null;
    materia: string | null; grupo: string | null;
    dia: string | null; hora_inicio: string | null; hora_fin: string | null;
  }>(
    `select a.id, a.tipo, a.severidad, a.detalle, a.slot_id, a.profesor_id, p.nombre profesor, s.plantel,
            m.nombre materia, g.clave grupo, s.dia, s.hora_inicio, s.hora_fin
       from alertas a
       left join profesores p on p.id = a.profesor_id
       left join slots s on s.id = a.slot_id
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       ${where}
      order by case a.severidad when 'alta' then 0 when 'media' then 1 else 2 end, a.tipo, a.id`,
    params);
}

// Conteo de alertas por tipo dentro del plantel elegido (para las tarjetas de resumen).
export async function getAlertasResumen(plantel?: string) {
  const cond = plantel ? "where s.plantel = $1" : "";
  const p = plantel ? [plantel] : [];
  return q<{ tipo: string; n: number }>(
    `select a.tipo, count(*)::int n
       from alertas a left join slots s on s.id = a.slot_id
       ${cond} group by a.tipo`, p);
}

// ---------- Dashboards (todo agregación sobre la BD, $0) ----------

export async function getDashCobertura(plantel?: string) {
  const cond = plantel ? "and s.plantel = $1" : "";
  const p = plantel ? [plantel] : [];
  const [estados] = await q<{ total: number; asignados: number; confirmados: number; sugeridos: number }>(
    `select count(*)::int total,
            count(*) filter (where a.profesor_id is not null)::int asignados,
            count(*) filter (where a.estado='confirmada')::int confirmados,
            count(*) filter (where a.estado='sugerida')::int sugeridos
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false ${cond}`, p);
  const porTipo = await q<{ tipo: string; n: number; asig: number }>(
    `select coalesce(s.tipo,'(sin tipo)') tipo, count(*)::int n,
            count(*) filter (where a.profesor_id is not null)::int asig
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false ${cond} group by s.tipo order by n desc`, p);
  const porTurno = await q<{ turno: string; n: number; asig: number }>(
    `select coalesce(s.turno,'(sin turno)') turno, count(*)::int n,
            count(*) filter (where a.profesor_id is not null)::int asig
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false ${cond} group by s.turno order by n desc`, p);
  const porCuatri = await q<{ cuatrimestre: string; n: number; asig: number }>(
    `select coalesce(s.cuatrimestre,'(s/c)') cuatrimestre, count(*)::int n,
            count(*) filter (where a.profesor_id is not null)::int asig
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false ${cond} group by s.cuatrimestre order by cuatrimestre`, p);
  return { estados, porTipo, porTurno, porCuatri };
}

export async function getDashDocentes(plantel?: string) {
  // La "carga" cuenta solo las asignaciones cuyo slot está en el plantel filtrado.
  const cond = plantel ? "and s.plantel = $1" : "";
  const p = plantel ? [plantel] : [];
  const [resumen] = await q<{ docentes: number; avgc: number; maxc: number; sobre: number }>(
    `select count(*)::int docentes, round(avg(c),1)::float avgc, coalesce(max(c),0)::int maxc,
            count(*) filter (where c > 12)::int sobre
       from (select a.profesor_id, count(*) c from asignaciones a join slots s on s.id = a.slot_id
              where a.profesor_id is not null ${cond} group by a.profesor_id) t`, p);
  const [hist] = await q<{ b1: number; b2: number; b3: number; b4: number }>(
    `select count(*) filter (where c between 1 and 3)::int b1,
            count(*) filter (where c between 4 and 6)::int b2,
            count(*) filter (where c between 7 and 12)::int b3,
            count(*) filter (where c > 12)::int b4
       from (select a.profesor_id, count(*) c from asignaciones a join slots s on s.id = a.slot_id
              where a.profesor_id is not null ${cond} group by a.profesor_id) t`, p);
  const top = await q<{ nombre: string; carga: number }>(
    `select pr.nombre, count(*)::int carga
       from asignaciones a join profesores pr on pr.id = a.profesor_id join slots s on s.id = a.slot_id
      where a.profesor_id is not null ${cond} group by pr.nombre order by carga desc limit 10`, p);
  // "Sin asignación": con plantel = docentes que dieron clase ahí en mayo pero no tienen
  // asignación ahí en septiembre. Sin plantel = docentes sin ninguna asignación.
  const sinAsignar = plantel
    ? await q<{ nombre: string }>(
      `select pr.nombre from profesores pr
        where pr.nombre <> all($2)
          and exists (select 1 from slots h where h.es_historial and h.plantel = $1 and h.docente_id = pr.id)
          and not exists (select 1 from asignaciones a join slots s on s.id = a.slot_id
                           where a.profesor_id = pr.id and s.plantel = $1)
        order by pr.nombre`, [plantel, PLACEHOLDERS])
    : await q<{ nombre: string }>(
      `select pr.nombre from profesores pr
        where pr.nombre <> all($1)
          and not exists (select 1 from asignaciones a where a.profesor_id = pr.id)
        order by pr.nombre`, [PLACEHOLDERS]);
  return { resumen, hist, top, sinAsignar };
}

export async function getDashRiesgos(plantel?: string) {
  const p = plantel ? [plantel] : [];
  const porTipo = await q<{ tipo: string; severidad: string; n: number }>(
    `select al.tipo, al.severidad, count(*)::int n from alertas al
       ${plantel ? "join slots s on s.id = al.slot_id where s.plantel = $1" : ""}
      group by al.tipo, al.severidad order by al.tipo`, p);
  const materiasSinCand = await q<{ materia: string; n: number }>(
    `select coalesce(m.nombre,'(sin materia)') materia, count(*)::int n
       from alertas al join slots s on s.id = al.slot_id
       left join materias m on m.id = s.materia_id
      where al.tipo = 'sin_candidato' ${plantel ? "and s.plantel = $1" : ""}
      group by m.nombre order by n desc limit 12`, p);
  return { porTipo, materiasSinCand };
}

export async function getDashRecomendacion(plantel?: string) {
  const cond = plantel ? "and s.plantel = $1" : "";
  const p = plantel ? [plantel] : [];
  const origen = await q<{ origen: string; n: number }>(
    `select case
              when a.razon ilike '%CV%' and (a.razon ilike '%mayo%' or a.razon ilike '%impart%') then 'Historial + CV'
              when a.razon ilike '%CV%' then 'Solo CV'
              else 'Solo historial' end origen,
            count(*)::int n
       from asignaciones a join slots s on s.id = a.slot_id
      where a.profesor_id is not null ${cond} group by 1 order by n desc`, p);
  const [calidad] = await q<{ puntaje_avg: number; automaticas: number; confirmadas: number }>(
    `select round(avg(a.puntaje),1)::float puntaje_avg,
            count(*) filter (where a.automatica)::int automaticas,
            count(*) filter (where not a.automatica)::int confirmadas
       from asignaciones a join slots s on s.id = a.slot_id
      where a.profesor_id is not null ${cond}`, p);
  // El pipeline de CVs es global (no depende del plantel).
  const [cv] = await q<{ procesados: number; asignables: number }>(
    `select (select count(*) from cv_competencias)::int procesados,
            (select count(*) from profesores where nombre <> all($1))::int asignables`, [PLACEHOLDERS]);
  return { origen, calidad, cv };
}
