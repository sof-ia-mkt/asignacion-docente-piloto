// Componentes visuales compartidos (server-safe, sin estado de cliente).

// Una clase ASINCRÓNICA (en línea, a ritmo del alumno) NO ocupa una hora fija: por diseño
// no lleva día/hora y no puede empalmarse con nada. Las demás (presencial/síncrona) sí ocupan
// un horario real. Se usa para decidir si exigir horario antes de asignar docente.
export const esAsincronica = (modalidad: string | null | undefined) =>
  (modalidad ?? "").toUpperCase().includes("ASINCR");

const SEV: Record<string, string> = {
  alta: "bg-red-100 text-red-800 border-red-200",
  media: "bg-amber-100 text-amber-800 border-amber-200",
  baja: "bg-slate-100 text-slate-700 border-slate-200",
};

export function Sev({ s }: { s: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${SEV[s] ?? SEV.baja}`}>
      {s}
    </span>
  );
}

const EST: Record<string, string> = {
  confirmada: "bg-green-100 text-green-800 border-green-200",
  sugerida: "bg-blue-100 text-blue-800 border-blue-200",
  rechazada: "bg-slate-100 text-slate-600 border-slate-200",
};
// "confirmada" es el estado por-MATERIA (hay un docente puesto en esa clase). Se muestra como
// "Asignada": la palabra "Confirmada" queda reservada para la PROPUESTA del docente (ver abajo).
const EST_LABEL: Record<string, string> = {
  confirmada: "Asignada", sugerida: "Sugerida", rechazada: "Sin asignar",
};

export function Estado({ e }: { e: string | null }) {
  if (!e) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${EST[e] ?? EST.rechazada}`}>
      {EST_LABEL[e] ?? e}
    </span>
  );
}

// Fuerza de la recomendación, traducida del puntaje a una palabra que el coordinador pueda leer
// de un vistazo (sin tener que conocer los números internos del motor). El puntaje suma señales:
// disponibilidad declarada (50), ya la dio antes (40), CV (25), mismo plantel (+20).
export function Fuerza({ puntaje, razon }: { puntaje: number | null; razon?: string | null }) {
  if (puntaje == null) return null;
  const nivel = puntaje >= 60 ? "alta" : puntaje >= 40 ? "media" : "baja";
  const cls = nivel === "alta"
    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : nivel === "media"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span title={razon ?? undefined}
      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium border ${cls}`}>
      coincidencia {nivel}
    </span>
  );
}

// Estado de la PROPUESTA del docente (por docente, no por materia): borrador → enviada → confirmada.
// "Confirmada" aquí SÍ significa que el docente aceptó y coordinación lo confirmó a mano.
const PROP: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-600 border-slate-200",
  enviada: "bg-amber-100 text-amber-800 border-amber-200",
  confirmada: "bg-green-100 text-green-800 border-green-200",
};
const PROP_LABEL: Record<string, string> = {
  borrador: "Borrador", enviada: "Propuesta enviada", confirmada: "Confirmada",
};
export const propuestaLabel = (e: string | null | undefined) => PROP_LABEL[e ?? "borrador"] ?? "Borrador";

export function PropuestaEstado({ e }: { e: string | null | undefined }) {
  const k = e ?? "borrador";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${PROP[k] ?? PROP.borrador}`}>
      {PROP_LABEL[k] ?? "Borrador"}
    </span>
  );
}

const TIPO_LABEL: Record<string, string> = {
  choque_horario: "Sin maestro por horario",
  sin_candidato: "Sin candidato",
  sobrecarga: "Sobrecarga",
  docente_repetido: "Docente repetido",
  sin_aula: "Sin aula",
  choque_aula: "Choque de aula",
  traslado_plantel: "Traslado entre planteles",
};
export const tipoLabel = (t: string) => TIPO_LABEL[t] ?? t;

// Etiqueta legible de la entidad tocada en la bitácora (historial de modificaciones).
const ENTIDAD_LABEL: Record<string, string> = {
  docente: "Docente",
  clase: "Clase",
  aula: "Aula",
  asignacion: "Asignación",
  candidatura: "Candidatura",
  cv: "CV",
};
export const entidadLabel = (e: string) => ENTIDAD_LABEL[e] ?? e;

// Color de pastilla por entidad, para que el historial se lea de un vistazo.
const ENTIDAD_COLOR: Record<string, string> = {
  docente: "bg-blue-100 text-blue-800 border-blue-200",
  clase: "bg-violet-100 text-violet-800 border-violet-200",
  aula: "bg-emerald-100 text-emerald-800 border-emerald-200",
  asignacion: "bg-amber-100 text-amber-800 border-amber-200",
  candidatura: "bg-sky-100 text-sky-800 border-sky-200",
  cv: "bg-rose-100 text-rose-800 border-rose-200",
};
export function EntidadBadge({ e }: { e: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${ENTIDAD_COLOR[e] ?? SEV.baja}`}>
      {entidadLabel(e)}
    </span>
  );
}

// Explicación legible de cada tipo de alerta, para coordinación. FUENTE ÚNICA: la usan
// el panel del inicio (acordeón) y la página de Alertas; no debe duplicarse en ningún otro lado.
//   idea    = titular de una línea (el "de qué va")
//   que     = qué significa, en lenguaje de coordinación
//   ejemplo = un caso concreto para aterrizarlo
export const ALERTA_INFO: Record<string, { idea: string; que: string; ejemplo: string }> = {
  sin_candidato: {
    idea: "Nadie la puede dar",
    que: "Para esa materia no hay ningún docente con historial ni CV que la respalde, así que el sistema no pudo proponer a nadie. Hay que buscar o contratar a un docente, o revisar si la materia sigue en el plan.",
    ejemplo: "Ej.: una materia que nadie dio en mayo y que no aparece en ningún CV del catálogo.",
  },
  choque_horario: {
    idea: "Hay quién, pero está ocupado",
    que: "La clase se quedó SIN maestro porque su mejor candidato ya está dando otra clase a esa misma hora. El sistema nunca pone a un docente en dos lugares a la vez: prefiere dejar la clase vacía y avisarte para que elijas a otro disponible o muevas el horario. (También salta si tú, a mano, asignas al mismo docente en dos clases encimadas.)",
    ejemplo: "Ej.: 'Programación móvil' (sábado 10:00) quedó sin maestro porque su mejor candidato ya da 'Algoritmos' ese mismo sábado a las 10:00.",
  },
  traslado_plantel: {
    idea: "Mismo día, otro campus",
    que: "El docente tiene dos clases el mismo día a horas distintas (no se enciman), pero en planteles diferentes y sin tiempo suficiente para trasladarse entre campus. Severidad alta = menos de 60 minutos entre una y otra.",
    ejemplo: "Ej.: termina en Casa Blanca 10:00 y empieza en Tecate 10:30; no alcanza a llegar.",
  },
  sobrecarga: {
    idea: "Demasiadas clases",
    que: "Un docente acumula más clases de las recomendadas para un cuatrimestre. Conviene repartir parte de su carga con otro profesor para que sea realista.",
    ejemplo: "Ej.: un profesor quedó asignado a 9 grupos cuando lo sano son menos.",
  },
  docente_repetido: {
    idea: "Todo en una persona",
    que: "El mismo docente quedó asignado en varios grupos de la misma materia. No es un error —a veces da dos grupos a propósito—, pero conviene revisar si dependemos demasiado de una sola persona.",
    ejemplo: "Ej.: el mismo profesor quedó en 3 grupos distintos de Álgebra.",
  },
  sin_aula: {
    idea: "Falta salón",
    que: "Una clase presencial que ya tiene docente pero a la que no se le pudo asignar salón: no hay un aula libre con cupo suficiente en ese horario. Casi siempre es por saturación de un mismo día.",
    ejemplo: "Ej.: muchas clases del sábado se quedan sin salón porque ese día se ocupan todas las aulas.",
  },
  choque_aula: {
    idea: "Dos clases, un salón",
    que: "Dos clases distintas quedaron en el mismo salón a la misma hora. Una de las dos necesita otra aula.",
    ejemplo: "Ej.: dos grupos asignados al aula 104 el sábado a las 11:00.",
  },
};

// Nombre corto del plan: "LICENCIATURA EN INGENIERÍA MECATRÓNICA" -> "Ing. Mecatrónica".
export function planCorto(nombre: string | null): string {
  if (!nombre) return "—";
  return nombre
    .replace(/^LICENCIATURA EN\s+/i, "")
    .replace(/INGENIER[IÍ]A EN\s+/i, "Ing. ")
    .replace(/INGENIER[IÍ]A\s+/i, "Ing. ")
    .toLowerCase()
    // Capitaliza la 1ª letra de cada palabra. \p{L} + flag u reconoce acentos
    // (á é í ó ú ñ), así no parte "mecatrónica" en "MecatróNica".
    .replace(/(^|\s)(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/\bIng\.\s*/i, "Ing. ");
}

// Etiqueta legible de un ciclo ("2026-2027-1" -> "Septiembre–Diciembre 2026").
// El sufijo marca el cuatrimestre del año lectivo: 1 = sep-dic (primer año),
// 2 = ene-abr (segundo año), 3 = may-ago (segundo año).
export function cicloLabel(ciclo: string | null): string {
  if (!ciclo) return "—";
  const m = ciclo.match(/^(\d{4})-(\d{4})-(\d)$/);
  if (!m) return ciclo;
  const [, a1, a2, suf] = m;
  const periodos: Record<string, [string, string]> = {
    "1": ["Septiembre–Diciembre", a1],
    "2": ["Enero–Abril", a2],
    "3": ["Mayo–Agosto", a2],
  };
  const p = periodos[suf];
  return p ? `${p[0]} ${p[1]}` : ciclo;
}

// Nombre corto y legible del plantel para chips/columnas.
const PLANTEL_CORTO: Record<string, string> = {
  "CASA BLANCA": "Casa Blanca",
  "OTAY": "Otay",
  "TECATE": "Tecate",
  "PALMAS": "Palmas",
};
export function plantelCorto(nombre: string | null): string {
  if (!nombre) return "—";
  return PLANTEL_CORTO[nombre.trim().toUpperCase()] ?? nombre;
}

// Etiqueta de color para el tipo de clase (Disciplinar / Módulo 1-3 / Virtual).
const CLASE_COLOR: Record<string, string> = {
  DISCIPLINAR: "bg-violet-100 text-violet-800 border-violet-200",
  VIRTUAL: "bg-sky-100 text-sky-800 border-sky-200",
  "MÓDULO 1": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "MÓDULO 2": "bg-amber-100 text-amber-800 border-amber-200",
  "MÓDULO 3": "bg-rose-100 text-rose-800 border-rose-200",
};
export function TipoClase({ t }: { t: string | null }) {
  if (!t) return <span className="text-slate-400 text-xs">—</span>;
  const key = t.trim().toUpperCase();
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${CLASE_COLOR[key] ?? SEV.baja}`}>
      {t}
    </span>
  );
}

// Etiqueta de plantel: dice si el docente dio la materia en el MISMO plantel del slot destino
// (lo más natural) o en OTRO plantel (válido, pero implica que el maestro se mueve de campus).
// Sin `destino`, solo informa dónde la dio (p.ej. en la ficha del maestro).
export function PlantelBadge({ planteles, destino }: { planteles: string[]; destino?: string | null }) {
  const limpios = planteles.filter(Boolean);
  if (limpios.length === 0) return <span className="text-slate-400 text-xs">—</span>;
  const cortos = [...new Set(limpios.map((p) => plantelCorto(p)))].join(", ");
  if (destino == null) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-slate-100 text-slate-600 border-slate-200">
        La dio en {cortos}
      </span>
    );
  }
  const mismo = limpios.includes(destino);
  return mismo ? (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-green-100 text-green-800 border-green-200">
      Mismo plantel
    </span>
  ) : (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-100 text-amber-800 border-amber-200">
      Otro plantel: {cortos}
    </span>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      {title && <h2 className="text-sm font-medium text-slate-700 mb-3">{title}</h2>}
      {children}
    </div>
  );
}

export function Card({ title, value, hint }: { title: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
