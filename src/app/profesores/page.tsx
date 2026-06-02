import Link from "next/link";
import { getProfesoresCV } from "@/lib/queries";

export default async function ProfesoresPage() {
  const profes = await getProfesoresCV();
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Profesores con CV</h1>
          <p className="text-sm text-slate-500">
            {profes.length} docentes del piloto. La plataforma leyó su CV y dedujo qué materias puede impartir.
          </p>
        </div>
        <Link href="/profesores/nuevo"
          className="shrink-0 px-3 py-2 rounded-md bg-slate-900 text-white text-sm">
          + Nuevo docente
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Docente</th>
              <th className="px-4 py-2 font-medium">Área (CV)</th>
              <th className="px-4 py-2 font-medium">Licenciatura</th>
              <th className="px-4 py-2 font-medium text-right">Exp.</th>
              <th className="px-4 py-2 font-medium text-right">Materias candidatas</th>
              <th className="px-4 py-2 font-medium text-right">Asignadas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profes.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/profesores/${p.id}`} className="text-blue-700 hover:underline font-medium">
                    {p.nombre}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">{p.area_cv ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{p.licenciatura ?? "—"}</td>
                <td className="px-4 py-2 text-right text-slate-600">{p.anios_experiencia ?? "—"}</td>
                <td className="px-4 py-2 text-right">{p.n_cand}</td>
                <td className="px-4 py-2 text-right">{p.n_asig}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
