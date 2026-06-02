import { q } from "./db";

// "Docentes" del Excel que no son personas (no asignables).
export const PLACEHOLDERS = ["CAMBIO DE TURNO", "DOCENTE NUEVO", "NO SE APERTURA", "NOSE APERTURA"];

export async function getResumen() {
  const [r] = await q<{
    sep_total: number; asignados: number; cvs: number; profes: number; materias: number;
  }>(`select
        (select count(*) from slots where es_historial=false)::int sep_total,
        (select count(*) from asignaciones where profesor_id is not null)::int asignados,
        (select count(*) from cv_competencias)::int cvs,
        (select count(*) from profesores)::int profes,
        (select count(*) from materias)::int materias`);
  const alertas = await q<{ tipo: string; n: number }>(
    "select tipo, count(*)::int n from alertas group by tipo");
  return { ...r, alertas };
}

export async function getProfesoresCV() {
  return q<{
    id: number; nombre: string; area_cv: string | null; anios_experiencia: number | null;
    licenciatura: string | null; n_cand: number; n_asig: number;
  }>(
    `select p.id, p.nombre, p.area_cv, p.anios_experiencia, p.licenciatura,
            (select count(*) from materia_candidatos mc where mc.profesor_id=p.id)::int n_cand,
            (select count(*) from asignaciones a where a.profesor_id=p.id)::int n_asig
       from profesores p
       join cv_competencias c on c.profesor_id = p.id
      order by p.nombre`);
}

export async function getProfesor(id: number) {
  const [prof] = await q<{
    id: number; nombre: string; licenciatura: string | null; maestria: string | null;
    area_cv: string | null; anios_experiencia: number | null; cv_archivo: string | null;
    payload: Record<string, unknown> | null; modelo: string | null;
  }>(
    `select p.id, p.nombre, p.licenciatura, p.maestria, p.area_cv, p.anios_experiencia, p.cv_archivo,
            c.payload, c.modelo
       from profesores p left join cv_competencias c on c.profesor_id = p.id
      where p.id = $1`, [id]);
  if (!prof) return null;
  const candidatas = await q<{ fuente: string; puntaje: number; razon: string; materia: string }>(
    `select mc.fuente, mc.puntaje, mc.razon, m.nombre materia
       from materia_candidatos mc join materias m on m.id = mc.materia_id
      where mc.profesor_id = $1 order by mc.puntaje desc, m.nombre`, [id]);
  const asignaciones = await q<{
    materia: string; grupo: string | null; dia: string | null; hora_inicio: string | null;
    hora_fin: string | null; estado: string;
  }>(
    `select m.nombre materia, g.clave grupo, s.dia, s.hora_inicio, s.hora_fin, a.estado
       from asignaciones a join slots s on s.id = a.slot_id
       join materias m on m.id = s.materia_id left join grupos g on g.id = s.grupo_id
      where a.profesor_id = $1 order by s.dia, s.hora_inicio`, [id]);
  return { prof, candidatas, asignaciones };
}

export type SlotFiltro = { estado?: string; q?: string };

export async function getSlotsSeptiembre(f: SlotFiltro, limit = 100) {
  const where: string[] = ["s.es_historial = false"];
  const params: unknown[] = [];
  if (f.q) { params.push(`%${f.q}%`); where.push(`(m.nombre ilike $${params.length} or g.clave ilike $${params.length})`); }
  if (f.estado === "asignado") where.push("a.profesor_id is not null");
  if (f.estado === "sin_asignar") where.push("a.profesor_id is null");
  params.push(limit);
  const rows = await q<{
    id: number; materia: string | null; grupo: string | null; dia: string | null;
    hora_inicio: string | null; hora_fin: string | null; tipo: string | null;
    docente: string | null; estado: string | null; puntaje: number | null;
  }>(
    `select s.id, m.nombre materia, g.clave grupo, s.dia, s.hora_inicio, s.hora_fin, s.tipo,
            p.nombre docente, a.estado, a.puntaje
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join asignaciones a on a.slot_id = s.id
       left join profesores p on p.id = a.profesor_id
      where ${where.join(" and ")}
      order by (a.profesor_id is null) desc, m.nombre, g.clave
      limit $${params.length}`, params);
  const [tot] = await q<{ n: number }>(
    "select count(*)::int n from slots s left join materias m on m.id=s.materia_id left join grupos g on g.id=s.grupo_id left join asignaciones a on a.slot_id=s.id where " + where.join(" and "),
    params.slice(0, params.length - 1));
  return { rows, total: tot.n };
}

export async function getSlot(id: number) {
  const [slot] = await q<{
    id: number; materia_id: number | null; materia: string | null; grupo: string | null;
    dia: string | null; hora_inicio: string | null; hora_fin: string | null; tipo: string | null;
    modalidad: string | null; cuatrimestre: string | null;
    docente_id: number | null; docente: string | null; estado: string | null;
    puntaje: number | null; razon: string | null;
  }>(
    `select s.id, s.materia_id, m.nombre materia, g.clave grupo, s.dia, s.hora_inicio, s.hora_fin,
            s.tipo, s.modalidad, s.cuatrimestre,
            a.profesor_id docente_id, p.nombre docente, a.estado, a.puntaje, a.razon
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join asignaciones a on a.slot_id = s.id
       left join profesores p on p.id = a.profesor_id
      where s.id = $1`, [id]);
  if (!slot) return null;
  const candidatos = slot.materia_id ? await q<{
    profesor_id: number; nombre: string; puntaje: number; fuentes: string; razon: string; carga: number;
  }>(
    `select mc.profesor_id, pr.nombre, sum(mc.puntaje)::int puntaje,
            string_agg(distinct mc.fuente, ',') fuentes,
            string_agg(mc.razon, ' | ' order by mc.puntaje desc) razon,
            (select count(*) from asignaciones a where a.profesor_id = mc.profesor_id)::int carga
       from materia_candidatos mc join profesores pr on pr.id = mc.profesor_id
      where mc.materia_id = $1 and mc.puntaje >= 25 and pr.nombre <> all($2)
      group by mc.profesor_id, pr.nombre
      order by puntaje desc, pr.nombre limit 8`, [slot.materia_id, PLACEHOLDERS]) : [];
  return { slot, candidatos };
}

export async function getMaterias() {
  return q<{ id: number; nombre: string }>("select id, nombre from materias order by nombre");
}

export async function getAlertas() {
  return q<{
    id: number; tipo: string; severidad: string; detalle: string;
    slot_id: number | null; profesor_id: number | null; profesor: string | null;
  }>(
    `select a.id, a.tipo, a.severidad, a.detalle, a.slot_id, a.profesor_id, p.nombre profesor
       from alertas a left join profesores p on p.id = a.profesor_id
      order by case a.severidad when 'alta' then 0 when 'media' then 1 else 2 end, a.tipo, a.id`);
}

// ---------- Dashboards (todo agregación sobre la BD, $0) ----------

export async function getDashCobertura() {
  const [estados] = await q<{ total: number; asignados: number; confirmados: number; sugeridos: number }>(
    `select count(*)::int total,
            count(*) filter (where a.profesor_id is not null)::int asignados,
            count(*) filter (where a.estado='confirmada')::int confirmados,
            count(*) filter (where a.estado='sugerida')::int sugeridos
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false`);
  const porTipo = await q<{ tipo: string; n: number; asig: number }>(
    `select coalesce(s.tipo,'(sin tipo)') tipo, count(*)::int n,
            count(*) filter (where a.profesor_id is not null)::int asig
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false group by s.tipo order by n desc`);
  const porTurno = await q<{ turno: string; n: number; asig: number }>(
    `select coalesce(s.turno,'(sin turno)') turno, count(*)::int n,
            count(*) filter (where a.profesor_id is not null)::int asig
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false group by s.turno order by n desc`);
  const porCuatri = await q<{ cuatrimestre: string; n: number; asig: number }>(
    `select coalesce(s.cuatrimestre,'(s/c)') cuatrimestre, count(*)::int n,
            count(*) filter (where a.profesor_id is not null)::int asig
       from slots s left join asignaciones a on a.slot_id = s.id
      where s.es_historial = false group by s.cuatrimestre order by cuatrimestre`);
  return { estados, porTipo, porTurno, porCuatri };
}

export async function getDashDocentes() {
  const [resumen] = await q<{ docentes: number; avgc: number; maxc: number; sobre: number }>(
    `select count(*)::int docentes, round(avg(c),1)::float avgc, max(c)::int maxc,
            count(*) filter (where c > 12)::int sobre
       from (select profesor_id, count(*) c from asignaciones
              where profesor_id is not null group by profesor_id) t`);
  const [hist] = await q<{ b1: number; b2: number; b3: number; b4: number }>(
    `select count(*) filter (where c between 1 and 3)::int b1,
            count(*) filter (where c between 4 and 6)::int b2,
            count(*) filter (where c between 7 and 12)::int b3,
            count(*) filter (where c > 12)::int b4
       from (select profesor_id, count(*) c from asignaciones
              where profesor_id is not null group by profesor_id) t`);
  const top = await q<{ nombre: string; carga: number }>(
    `select p.nombre, count(*)::int carga
       from asignaciones a join profesores p on p.id = a.profesor_id
      group by p.nombre order by carga desc limit 10`);
  const sinAsignar = await q<{ nombre: string }>(
    `select p.nombre from profesores p
      where p.nombre <> all($1)
        and not exists (select 1 from asignaciones a where a.profesor_id = p.id)
      order by p.nombre`, [PLACEHOLDERS]);
  return { resumen, hist, top, sinAsignar };
}

export async function getDashRiesgos() {
  const porTipo = await q<{ tipo: string; severidad: string; n: number }>(
    `select tipo, severidad, count(*)::int n from alertas group by tipo, severidad order by tipo`);
  const materiasSinCand = await q<{ materia: string; n: number }>(
    `select coalesce(m.nombre,'(sin materia)') materia, count(*)::int n
       from alertas al join slots s on s.id = al.slot_id
       left join materias m on m.id = s.materia_id
      where al.tipo = 'sin_candidato'
      group by m.nombre order by n desc limit 12`);
  return { porTipo, materiasSinCand };
}

export async function getDashRecomendacion() {
  const origen = await q<{ origen: string; n: number }>(
    `select case
              when razon ilike '%CV%' and (razon ilike '%mayo%' or razon ilike '%impart%') then 'Historial + CV'
              when razon ilike '%CV%' then 'Solo CV'
              else 'Solo historial' end origen,
            count(*)::int n
       from asignaciones where profesor_id is not null group by 1 order by n desc`);
  const [calidad] = await q<{ puntaje_avg: number; automaticas: number; confirmadas: number }>(
    `select round(avg(puntaje),1)::float puntaje_avg,
            count(*) filter (where automatica)::int automaticas,
            count(*) filter (where not automatica)::int confirmadas
       from asignaciones where profesor_id is not null`);
  const [cv] = await q<{ procesados: number; asignables: number }>(
    `select (select count(*) from cv_competencias)::int procesados,
            (select count(*) from profesores where nombre <> all($1))::int asignables`, [PLACEHOLDERS]);
  return { origen, calidad, cv };
}
