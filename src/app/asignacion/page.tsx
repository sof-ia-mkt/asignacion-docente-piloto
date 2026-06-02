import Link from "next/link";
import { getSlotsSeptiembre, getPlanteles } from "@/lib/queries";
import { Estado, TipoClase, planCorto, plantelCorto } from "@/lib/ui";

const FILTROS = [
  { v: "", label: "Todos" },
  { v: "sin_asignar", label: "Sin asignar" },
  { v: "asignado", label: "Asignados" },
];

export default async function AsignacionPage({
  searchParams,
}: { searchParams: Promise<{ estado?: string; q?: string; plantel?: string }> }) {
  const sp = await searchParams;
  const estado = sp.estado ?? "";
  const qstr = sp.q ?? "";
  const plantel = sp.plantel ?? "";
  const [{ rows, total }, planteles] = await Promise.all([
    getSlotsSeptiembre({ estado, q: qstr, plantel }),
    getPlanteles(),
  ]);

  // Construye un href de /asignacion conservando los filtros actuales y cambiando uno.
  const href = (cambios: Record<string, string>) => {
    const base = { ...(estado ? { estado } : {}), ...(qstr ? { q: qstr } : {}), ...(plantel ? { plantel } : {}) };
    const merged = { ...base, ...cambios };
    const limpio = Object.fromEntries(Object.entries(merged).filter(([, val]) => val));
    const qsParams = new URLSearchParams(limpio).toString();
    return `/asignacion${qsParams ? `?${qsParams}` : ""}`;
  };
  const chip = (activo: boolean) =>
    `px-3 py-1.5 rounded-md text-sm border ${activo ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Asignación de septiembre</h1>
          <p className="text-sm text-slate-500">
            {total} materias por grupo{plantel ? ` en ${plantelCorto(plantel)}` : " (todos los planteles)"}. Sin asignar aparecen primero.
          </p>
        </div>
        <Link href="/asignacion/nueva" className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm whitespace-nowrap">
          + Nueva materia por grupo
        </Link>
      </div>

      <div className="flex flex-wrap gap-1 items-center">
        <span className="text-xs text-slate-400 mr-1">Plantel:</span>
        <Link href={href({ plantel: "" })} className={chip(plantel === "")}>Todos</Link>
        {planteles.map((p) => (
          <Link key={p.plantel} href={href({ plantel: p.plantel })} className={chip(plantel === p.plantel)}>
            {plantelCorto(p.plantel)} <span className={plantel === p.plantel ? "text-slate-300" : "text-slate-400"}>· {p.n}</span>
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          {FILTROS.map((f) => (
            <Link key={f.v} href={href({ estado: f.v })} className={chip(estado === f.v)}>
              {f.label}
            </Link>
          ))}
        </div>
        <input name="q" defaultValue={qstr} placeholder="Buscar materia o grupo…"
          className="px-3 py-1.5 rounded-md border border-slate-200 text-sm w-64" />
        {estado && <input type="hidden" name="estado" value={estado} />}
        {plantel && <input type="hidden" name="plantel" value={plantel} />}
        <button className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm">Buscar</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Plantel</th>
              <th className="px-4 py-2 font-medium">Materia</th>
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 font-medium">Cuatri</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Grupo</th>
              <th className="px-4 py-2 font-medium text-right">Alumnos</th>
              <th className="px-4 py-2 font-medium">Aula</th>
              <th className="px-4 py-2 font-medium">Horario</th>
              <th className="px-4 py-2 font-medium">Docente</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-500">{plantelCorto(s.plantel)}</td>
                <td className="px-4 py-2 text-slate-800">{s.materia ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{planCorto(s.plan)}</td>
                <td className="px-4 py-2 text-slate-600">{s.cuatrimestre ?? "—"}</td>
                <td className="px-4 py-2"><TipoClase t={s.tipo} /></td>
                <td className="px-4 py-2 text-slate-600">{s.grupo ?? "—"}</td>
                <td className="px-4 py-2 text-right text-slate-600">{s.alumnos ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2 text-slate-600">{s.aula ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2 text-slate-600">{s.dia ? `${s.dia} ${s.hora_inicio}-${s.hora_fin}` : "—"}</td>
                <td className="px-4 py-2 text-slate-700">{s.docente ?? <span className="text-slate-400">sin docente</span>}</td>
                <td className="px-4 py-2"><Estado e={s.estado} /></td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/asignacion/${s.id}`} className="text-blue-700 hover:underline">Revisar</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === total ? null : (
        <p className="text-xs text-slate-400">Mostrando {rows.length} de {total}. Afina con la búsqueda.</p>
      )}
    </div>
  );
}
