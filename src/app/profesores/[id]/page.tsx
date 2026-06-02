import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfesor } from "@/lib/queries";
import { Estado } from "@/lib/ui";

export default async function ProfesorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getProfesor(Number(id));
  if (!data) notFound();
  const { prof, candidatas, asignaciones } = data;

  return (
    <div className="space-y-5">
      <Link href="/profesores" className="text-sm text-blue-700 hover:underline">← Profesores</Link>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">{prof.nombre}</h1>
        <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-slate-500">Licenciatura</dt><dd className="text-slate-800">{prof.licenciatura ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Maestría</dt><dd className="text-slate-800">{prof.maestria ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Área (CV)</dt><dd className="text-slate-800">{prof.area_cv ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Experiencia</dt><dd className="text-slate-800">{prof.anios_experiencia ?? "—"} años</dd></div>
        </dl>
        {prof.cv_archivo && (
          <p className="mt-2 text-xs text-slate-400">CV: {prof.cv_archivo} · leído por {prof.modelo ?? "—"}</p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Materias candidatas (historial + CV)</h2>
        {candidatas.length === 0 ? (
          <p className="text-sm text-slate-400">Sin candidaturas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-left">
              <tr><th className="py-1 font-medium">Materia</th><th className="py-1 font-medium">Fuente</th><th className="py-1 font-medium text-right">Puntaje</th><th className="py-1 font-medium">Razón</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {candidatas.map((c, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2 text-slate-800">{c.materia}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{c.fuente}</td>
                  <td className="py-1.5 pr-2 text-right font-medium">{c.puntaje}</td>
                  <td className="py-1.5 text-slate-500">{c.razon}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Asignaciones de septiembre</h2>
        {asignaciones.length === 0 ? (
          <p className="text-sm text-slate-400">Sin asignaciones.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-left">
              <tr><th className="py-1 font-medium">Materia</th><th className="py-1 font-medium">Grupo</th><th className="py-1 font-medium">Horario</th><th className="py-1 font-medium">Estado</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {asignaciones.map((a, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2 text-slate-800">{a.materia}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{a.grupo ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{a.dia ? `${a.dia} ${a.hora_inicio}-${a.hora_fin}` : "—"}</td>
                  <td className="py-1.5"><Estado e={a.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
