import Link from "next/link";
import { getSlotsSeptiembre } from "@/lib/queries";
import { Estado } from "@/lib/ui";

const FILTROS = [
  { v: "", label: "Todos" },
  { v: "sin_asignar", label: "Sin asignar" },
  { v: "asignado", label: "Asignados" },
];

export default async function AsignacionPage({
  searchParams,
}: { searchParams: Promise<{ estado?: string; q?: string }> }) {
  const sp = await searchParams;
  const estado = sp.estado ?? "";
  const qstr = sp.q ?? "";
  const { rows, total } = await getSlotsSeptiembre({ estado, q: qstr });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Asignación de septiembre</h1>
        <p className="text-sm text-slate-500">{total} slots. Sin asignar aparecen primero.</p>
      </div>

      <form className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          {FILTROS.map((f) => (
            <Link key={f.v}
              href={`/asignacion?${new URLSearchParams({ ...(f.v ? { estado: f.v } : {}), ...(qstr ? { q: qstr } : {}) })}`}
              className={`px-3 py-1.5 rounded-md text-sm border ${estado === f.v ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
              {f.label}
            </Link>
          ))}
        </div>
        <input name="q" defaultValue={qstr} placeholder="Buscar materia o grupo…"
          className="px-3 py-1.5 rounded-md border border-slate-200 text-sm w-64" />
        {estado && <input type="hidden" name="estado" value={estado} />}
        <button className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm">Buscar</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Materia</th>
              <th className="px-4 py-2 font-medium">Grupo</th>
              <th className="px-4 py-2 font-medium">Horario</th>
              <th className="px-4 py-2 font-medium">Docente</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-800">{s.materia ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{s.grupo ?? "—"}</td>
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
