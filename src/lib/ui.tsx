// Componentes visuales compartidos (server-safe, sin estado de cliente).

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
const EST_LABEL: Record<string, string> = {
  confirmada: "Confirmada", sugerida: "Sugerida", rechazada: "Sin asignar",
};

export function Estado({ e }: { e: string | null }) {
  if (!e) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${EST[e] ?? EST.rechazada}`}>
      {EST_LABEL[e] ?? e}
    </span>
  );
}

const TIPO_LABEL: Record<string, string> = {
  choque_horario: "Choque de horario",
  sin_candidato: "Sin candidato",
  sobrecarga: "Sobrecarga",
  docente_repetido: "Docente repetido",
  sin_aula: "Sin aula",
  choque_aula: "Choque de aula",
  traslado_plantel: "Traslado entre planteles",
};
export const tipoLabel = (t: string) => TIPO_LABEL[t] ?? t;

// Nombre corto del plan: "LICENCIATURA EN INGENIERÍA MECATRÓNICA" -> "Ing. Mecatrónica".
export function planCorto(nombre: string | null): string {
  if (!nombre) return "—";
  return nombre
    .replace(/^LICENCIATURA EN\s+/i, "")
    .replace(/INGENIER[IÍ]A EN\s+/i, "Ing. ")
    .replace(/INGENIER[IÍ]A\s+/i, "Ing. ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bIng\.\s*/i, "Ing. ");
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
