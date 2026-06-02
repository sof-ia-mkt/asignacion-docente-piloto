import Link from "next/link";
import { getResumen } from "@/lib/queries";
import { Card, Sev, tipoLabel } from "@/lib/ui";

export default async function Home() {
  const r = await getResumen();
  const sinAsignar = r.sep_total - r.asignados;
  const pct = r.sep_total ? Math.round((r.asignados / r.sep_total) * 100) : 0;
  const totalAlertas = r.alertas.reduce((a, x) => a + x.n, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Panel de coordinación</h1>
        <p className="text-sm text-slate-500">
          Cuatrimestre a asignar (septiembre), recomendado a partir del historial de mayo y los CV.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Materias por asignar" value={r.sep_total} hint="septiembre" />
        <Card title="Asignados" value={`${r.asignados}`} hint={`${pct}% del total`} />
        <Card title="Sin asignar" value={sinAsignar} hint="requieren revisión" />
        <Card title="Alertas" value={totalAlertas} hint="ver detalle" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Alertas por tipo</h2>
          {r.alertas.length === 0 ? (
            <p className="text-sm text-slate-400">Sin alertas.</p>
          ) : (
            <ul className="space-y-2">
              {r.alertas.map((a) => (
                <li key={a.tipo} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{tipoLabel(a.tipo)}</span>
                  <span className="font-semibold text-slate-900">{a.n}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/alertas" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Ver todas las alertas →
          </Link>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Catálogo</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Materias</dt><dd className="font-semibold">{r.materias}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Profesores</dt><dd className="font-semibold">{r.profes}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">CV procesados</dt><dd className="font-semibold">{r.cvs}</dd></div>
          </dl>
          <div className="mt-3 flex gap-3">
            <Link href="/profesores" className="text-sm text-blue-700 hover:underline">Profesores con CV →</Link>
            <Link href="/asignacion" className="text-sm text-blue-700 hover:underline">Revisar asignación →</Link>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        <Sev s="alta" /> indica prioridad. Las sugerencias son automáticas; coordinación confirma o cambia cada materia.
      </p>
    </div>
  );
}
