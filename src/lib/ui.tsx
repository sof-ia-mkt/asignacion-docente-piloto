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
};
export const tipoLabel = (t: string) => TIPO_LABEL[t] ?? t;

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
