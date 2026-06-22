// Registro central de "reportes": traduce los datos de cada pantalla a tablas
// (encabezados + filas). UNA sola fuente de verdad que consumen tanto la exportación
// a Excel (route handler /export) como la vista de impresión/PDF (/imprimir).
// Así no se duplica la lógica de "qué columnas lleva cada pantalla".
//
// SOLO servidor (lee de la base vía queries.ts).

import {
  getSlotsSeptiembre,
  getProfesores,
  getProfesor,
  getAulas,
  getAlertas,
  getDashCobertura,
  getDashDocentes,
  getDashRiesgos,
  getDashRecomendacion,
  getBitacora,
} from "./queries";
import { plantelCorto, planCorto, tipoLabel, entidadLabel } from "./ui";

export type ReportTable = { name: string; headers: string[]; rows: (string | number | null)[][] };
export type Report = { filename: string; title: string; subtitle?: string; tables: ReportTable[] };

// ---------- helpers ----------

const hoy = () => new Date().toISOString().slice(0, 10);

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "datos";

const estadoLabel = (e: string | null): string =>
  e === "confirmada" ? "Aprobada" : e === "sugerida" ? "Propuesta (a revisión)" : "Sin propuesta";

const sevLabel = (s: string): string =>
  s === "alta" ? "Alta" : s === "media" ? "Media" : s === "baja" ? "Baja" : s;

const horario = (dia: string | null, hi: string | null, hf: string | null): string =>
  dia && dia !== "N/A" && hi && hf ? `${dia} ${hi}-${hf}` : "";

const plantelesLegibles = (csv: string | null): string =>
  csv ? [...new Set(csv.split(",").filter(Boolean).map(plantelCorto))].join(", ") : "";

// ---------- reportes por pantalla ----------

async function reporteAsignacion(p: URLSearchParams): Promise<Report> {
  const f = {
    estado: p.get("estado") ?? "",
    q: p.get("q") ?? "",
    plantel: p.get("plantel") ?? "",
    cuatri: p.get("cuatri") ?? "",
    tipo: p.get("tipo") ?? "",
  };
  // Sin paginar: el export trae TODAS las filas que cumplen el filtro.
  const { rows, total } = await getSlotsSeptiembre(f, 100000);
  const ambito = f.plantel ? plantelCorto(f.plantel) : "todos los planteles";
  const filtros = [
    f.estado === "asignado" ? "aprobadas" : f.estado === "sin_asignar" ? "sin propuesta" : f.estado === "por_revisar" ? "a revisión" : "",
    f.cuatri ? `cuatri ${f.cuatri}` : "",
    f.tipo ? `tipo ${f.tipo}` : "",
    f.q ? `búsqueda "${f.q}"` : "",
  ].filter(Boolean);
  return {
    filename: `asignacion-${slug(ambito)}-${hoy()}`,
    title: "Asignación de septiembre",
    subtitle: `${total} materias por grupo · ${ambito}${filtros.length ? ` · ${filtros.join(" · ")}` : ""}`,
    tables: [
      {
        name: "Asignación",
        headers: ["Plantel", "Materia", "Plan", "Cuatri", "Tipo", "Grupo", "Alumnos", "Aula", "Horario", "Docente", "Estado", "Compactada"],
        rows: rows.map((s) => [
          plantelCorto(s.plantel),
          s.materia ?? "",
          planCorto(s.plan),
          s.cuatrimestre ?? "",
          s.tipo ?? "",
          s.grupo ?? "",
          s.alumnos ?? "",
          s.aula ?? "",
          horario(s.dia, s.hora_inicio, s.hora_fin),
          s.docente ?? "",
          estadoLabel(s.estado),
          // Marca la clase compactada (varios grupos = una sola clase): el id agrupa a sus miembros.
          s.compactacion_id != null ? `Sí (#${s.compactacion_id})` : "",
        ]),
      },
    ],
  };
}

async function reporteProfesores(p: URLSearchParams): Promise<Report> {
  const cvRaw = p.get("cv") ?? "";
  const cv = (cvRaw === "cv" || cvRaw === "sincv" ? cvRaw : "") as "" | "cv" | "sincv";
  const coord = p.get("coord") ?? "";
  const profes = await getProfesores(cv, coord);
  const filtros = [
    cv === "cv" ? "con CV" : cv === "sincv" ? "sin CV" : "",
    coord ? `coordinación ${coord}` : "",
  ].filter(Boolean);
  return {
    filename: `profesores-${hoy()}`,
    title: "Profesores",
    subtitle: `${profes.length} docentes${filtros.length ? ` · ${filtros.join(" · ")}` : ""}`,
    tables: [
      {
        name: "Profesores",
        headers: ["Docente", "Coordinación", "CV", "Plantel(es)", "Licenciatura", "Años exp.", "Materias candidatas", "Clases propuestas"],
        rows: profes.map((d) => [
          d.nombre,
          d.coordinador ?? "",
          d.tiene_cv ? "Sí" : "No",
          plantelesLegibles(d.planteles),
          d.licenciatura ?? "",
          d.anios_experiencia ?? "",
          d.n_cand,
          d.n_asig,
        ]),
      },
    ],
  };
}

async function reporteProfesor(p: URLSearchParams): Promise<Report> {
  const id = Number(p.get("id"));
  const data = id ? await getProfesor(id) : null;
  if (!data) return { filename: `docente-${hoy()}`, title: "Docente no encontrado", tables: [] };
  const { prof, candidatas, asignaciones, historial } = data;

  // Materias candidatas: una por materia, con su señal más fuerte (igual que la ficha).
  const porMateria = new Map<number, (typeof candidatas)[number]>();
  for (const c of candidatas) {
    const prev = porMateria.get(c.materia_id);
    if (!prev || c.puntaje > prev.puntaje) porMateria.set(c.materia_id, c);
  }
  const materias = [...porMateria.values()].sort((a, b) => b.puntaje - a.puntaje);

  return {
    filename: `docente-${slug(prof.nombre)}-${hoy()}`,
    title: prof.nombre,
    subtitle: `Ficha de docente · ${prof.coordinador ? `Coordinación ${prof.coordinador}` : "sin coordinación"}`,
    tables: [
      {
        name: "Datos",
        headers: ["Campo", "Valor"],
        rows: [
          ["Nombre", prof.nombre],
          ["Coordinación", prof.coordinador ?? ""],
          ["Licenciatura", prof.licenciatura ?? ""],
          ["Maestría", prof.maestria ?? ""],
          ["Doctorado", prof.doctorado ?? ""],
          ["Años de experiencia", prof.anios_experiencia ?? ""],
          ["CV", prof.cv_archivo ? `Leído (${prof.cv_archivo})` : "Sin CV"],
        ],
      },
      {
        name: "Clases septiembre",
        headers: ["Materia", "Tipo", "Grupo", "Plantel", "Horario", "Estado"],
        rows: asignaciones.map((a) => [
          a.materia,
          a.tipo ?? "",
          a.grupo ?? "",
          plantelCorto(a.plantel),
          horario(a.dia, a.hora_inicio, a.hora_fin),
          estadoLabel(a.estado),
        ]),
      },
      {
        name: "Historial mayo",
        headers: ["Materia", "Tipo", "Grupo", "Plantel", "Cuatrimestre"],
        rows: historial.map((h) => [h.materia, h.tipo ?? "", h.grupo ?? "", plantelCorto(h.plantel), h.cuatrimestre ?? ""]),
      },
      {
        name: "Materias que puede dar",
        headers: ["Materia", "Puntaje", "Fuente"],
        rows: materias.map((c) => [c.materia, c.puntaje, c.fuente]),
      },
    ],
  };
}

async function reporteAulas(): Promise<Report> {
  const { aulas } = await getAulas();
  return {
    filename: `aulas-${hoy()}`,
    title: "Aulas",
    subtitle: `${aulas.length} salones en el catálogo`,
    tables: [
      {
        name: "Aulas",
        headers: ["Aula", "Tipo", "Capacidad", "Uso (clases)"],
        rows: aulas.map((a) => [a.clave, a.tipo ?? "", a.capacidad ?? "", a.en_uso]),
      },
    ],
  };
}

async function reporteAlertas(p: URLSearchParams): Promise<Report> {
  const tipo = p.get("tipo") ?? "";
  const sevParam = p.get("severidad") ?? "alta"; // mismo default que la pantalla
  const severidad = sevParam === "todas" ? "" : sevParam;
  const plantel = p.get("plantel") ?? "";
  const alertas = await getAlertas({ tipo, severidad, plantel });
  const filtros = [
    tipo ? tipoLabel(tipo) : "",
    severidad ? `prioridad ${sevLabel(severidad)}` : "todas las prioridades",
    plantel ? plantelCorto(plantel) : "",
  ].filter(Boolean);
  return {
    filename: `alertas-${hoy()}`,
    title: "Alertas",
    subtitle: `${alertas.length} alertas${filtros.length ? ` · ${filtros.join(" · ")}` : ""}`,
    tables: [
      {
        name: "Alertas",
        headers: ["Prioridad", "Tipo", "Materia", "Grupo", "Cuándo", "Plantel", "Detalle", "Docente"],
        rows: alertas.map((a) => [
          sevLabel(a.severidad),
          tipoLabel(a.tipo),
          a.materia ?? "",
          a.grupo ?? "",
          horario(a.dia, a.hora_inicio, a.hora_fin),
          plantelCorto(a.plantel),
          a.detalle,
          a.profesor ?? "",
        ]),
      },
    ],
  };
}

async function reporteDashboard(p: URLSearchParams): Promise<Report> {
  const vista = p.get("vista") ?? "resumen";
  const plantel = p.get("plantel") ?? "";
  const ambito = plantel ? plantelCorto(plantel) : "todos los planteles";
  const base = { filename: `dashboard-${slug(vista)}-${slug(ambito)}-${hoy()}` };

  if (vista === "cobertura") {
    const { estados: e, porTipo, porTurno, porCuatri } = await getDashCobertura(plantel);
    return {
      ...base,
      title: "Dashboard · Cobertura",
      subtitle: ambito,
      tables: [
        {
          name: "Resumen",
          headers: ["Indicador", "Valor"],
          rows: [
            ["Total de clases", e.total],
            ["Con propuesta de asignación", e.asignados],
            ["Sin propuesta", e.total - e.asignados],
            ["Aprobadas", e.confirmados],
            ["Propuestas a revisión", e.sugeridos],
          ],
        },
        { name: "Por tipo", headers: ["Tipo", "Total", "Con propuesta"], rows: porTipo.map((r) => [r.tipo, r.n, r.asig]) },
        { name: "Por turno", headers: ["Turno", "Total", "Con propuesta"], rows: porTurno.map((r) => [r.turno, r.n, r.asig]) },
        { name: "Por cuatrimestre", headers: ["Cuatrimestre", "Total", "Con propuesta"], rows: porCuatri.map((r) => [r.cuatrimestre, r.n, r.asig]) },
      ],
    };
  }

  if (vista === "docentes") {
    const { resumen, hist, top, sinAsignar } = await getDashDocentes(plantel);
    return {
      ...base,
      title: "Dashboard · Docentes",
      subtitle: ambito,
      tables: [
        {
          name: "Resumen",
          headers: ["Indicador", "Valor"],
          rows: [
            ["Docentes con carga", resumen.docentes],
            ["Carga promedio (materias/docente)", resumen.avgc],
            ["Carga máxima", resumen.maxc],
            ["Sobrecargados (>12)", resumen.sobre],
          ],
        },
        {
          name: "Distribución de carga",
          headers: ["Rango de materias", "Docentes"],
          rows: [["1–3", hist.b1], ["4–6", hist.b2], ["7–12", hist.b3], ["13+", hist.b4]],
        },
        { name: "Top 10 más cargados", headers: ["Docente", "Carga"], rows: top.map((t) => [t.nombre, t.carga]) },
        { name: "Sin asignación", headers: ["Docente"], rows: sinAsignar.map((d) => [d.nombre]) },
      ],
    };
  }

  if (vista === "riesgos") {
    const { porTipo, materiasSinCand } = await getDashRiesgos(plantel);
    return {
      ...base,
      title: "Dashboard · Riesgos",
      subtitle: ambito,
      tables: [
        {
          name: "Alertas por tipo",
          headers: ["Tipo", "Severidad", "Total"],
          rows: porTipo.map((r) => [tipoLabel(r.tipo), sevLabel(r.severidad), r.n]),
        },
        { name: "Materias críticas", headers: ["Materia", "Grupos sin candidato"], rows: materiasSinCand.map((m) => [m.materia, m.n]) },
      ],
    };
  }

  if (vista === "recomendacion") {
    const { origen, calidad, cv } = await getDashRecomendacion(plantel);
    return {
      ...base,
      title: "Dashboard · Recomendación",
      subtitle: ambito,
      tables: [
        { name: "Origen de la asignación", headers: ["Origen", "Asignaciones"], rows: origen.map((o) => [o.origen, o.n]) },
        {
          name: "Calidad",
          headers: ["Indicador", "Valor"],
          rows: [
            ["Puntaje promedio", calidad.puntaje_avg],
            ["Automáticas (motor)", calidad.automaticas],
            ["Hechas a mano", calidad.manuales],
          ],
        },
        {
          name: "CV",
          headers: ["Indicador", "Valor"],
          rows: [["CV procesados", cv.procesados], ["Docentes asignables", cv.asignables]],
        },
      ],
    };
  }

  // resumen general
  const [cob, doc, rie, rec] = await Promise.all([
    getDashCobertura(plantel),
    getDashDocentes(plantel),
    getDashRiesgos(plantel),
    getDashRecomendacion(plantel),
  ]);
  const e = cob.estados;
  const totalAlertas = rie.porTipo.reduce((a, x) => a + x.n, 0);
  const altas = rie.porTipo.filter((x) => x.severidad === "alta").reduce((a, x) => a + x.n, 0);
  return {
    ...base,
    title: "Dashboard · Resumen",
    subtitle: ambito,
    tables: [
      {
        name: "Resumen general",
        headers: ["Indicador", "Valor"],
        rows: [
          ["Clases de septiembre", e.total],
          ["Con propuesta de asignación", e.asignados],
          ["Sin propuesta", e.total - e.asignados],
          ["Aprobadas", e.confirmados],
          ["Propuestas a revisión", e.sugeridos],
          ["Docentes con carga", doc.resumen.docentes],
          ["Carga promedio", doc.resumen.avgc],
          ["Sobrecargados (>12)", doc.resumen.sobre],
          ["Alertas totales", totalAlertas],
          ["Alertas prioridad alta", altas],
          ["CV procesados", rec.cv.procesados],
          ["Docentes asignables", rec.cv.asignables],
        ],
      },
    ],
  };
}

// Fecha/hora legible para coordinación, en horario de Tijuana (el del piloto).
const fechaHora = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Tijuana",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
};

async function reporteBitacora(p: URLSearchParams): Promise<Report> {
  const f = {
    entidad: p.get("entidad") ?? "",
    accion: p.get("accion") ?? "",
    q: p.get("q") ?? "",
    desde: p.get("desde") ?? "",
  };
  // Sin paginar: el export trae TODO el historial que cumple el filtro.
  const { rows, total } = await getBitacora(f, 100000);
  const filtros = [
    f.entidad ? entidadLabel(f.entidad) : "",
    f.accion ? `acción ${f.accion}` : "",
    f.desde ? `desde ${f.desde}` : "",
    f.q ? `búsqueda "${f.q}"` : "",
  ].filter(Boolean);
  return {
    filename: `historial-${hoy()}`,
    title: "Historial de modificaciones",
    subtitle: `${total} movimiento(s)${filtros.length ? ` · ${filtros.join(" · ")}` : ""}`,
    tables: [
      {
        name: "Historial",
        headers: ["Fecha y hora", "Quién", "Qué", "Acción", "Detalle"],
        rows: rows.map((r) => [
          fechaHora(r.creado_en),
          r.actor,
          entidadLabel(r.entidad),
          r.accion,
          r.descripcion,
        ]),
      },
    ],
  };
}

const REPORTES: Record<string, (p: URLSearchParams) => Promise<Report>> = {
  asignacion: reporteAsignacion,
  profesores: reporteProfesores,
  profesor: reporteProfesor,
  aulas: () => reporteAulas(),
  alertas: reporteAlertas,
  dashboard: reporteDashboard,
  historial: reporteBitacora,
};

/** Devuelve el reporte para una pantalla, o null si el tipo no existe. */
export async function getReport(tipo: string, params: URLSearchParams): Promise<Report | null> {
  const fn = REPORTES[tipo];
  return fn ? fn(params) : null;
}
