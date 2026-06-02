import Link from "next/link";
import { getAlertas } from "@/lib/queries";
import { Sev, tipoLabel } from "@/lib/ui";

export default async function AlertasPage() {
  const alertas = await getAlertas();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Alertas</h1>
        <p className="text-sm text-slate-500">{alertas.length} alertas, ordenadas por prioridad.</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Severidad</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Detalle</th>
              <th className="px-4 py-2 font-medium">Docente</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {alertas.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50 align-top">
                <td className="px-4 py-2"><Sev s={a.severidad} /></td>
                <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{tipoLabel(a.tipo)}</td>
                <td className="px-4 py-2 text-slate-600">{a.detalle}</td>
                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                  {a.profesor_id ? (
                    <Link href={`/profesores/${a.profesor_id}`} className="text-blue-700 hover:underline">{a.profesor ?? "ver"}</Link>
                  ) : "—"}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {a.slot_id && (
                    <Link href={`/asignacion/${a.slot_id}`} className="text-blue-700 hover:underline">Revisar slot</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
