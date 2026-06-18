import Link from "next/link";
import { getResumen } from "@/lib/queries";
import { cicloActivo } from "@/lib/ciclo";
import { Card, Sev } from "@/lib/ui";
import { ExportButtons } from "@/lib/export-buttons";
import { AlertasPorTipo } from "./alertas-por-tipo";

export default async function Home() {
  const [r, act] = await Promise.all([getResumen(), cicloActivo()]);
  const sinAsignar = r.sep_total - r.asignados;
  const pct = r.sep_total ? Math.round((r.asignados / r.sep_total) * 100) : 0;
  const totalAlertas = r.alertas.reduce((a, x) => a + x.n, 0);
  const esHistorial = act.estado === "historial";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Panel de coordinación</h1>
          <p className="text-sm text-slate-500">
            {esHistorial
              ? `Ciclo en consulta: ${act.nombre} (historial). Solo lectura.`
              : `Ciclo a asignar: ${act.nombre}, recomendado a partir del historial y los CV.`}
          </p>
        </div>
        <ExportButtons tipo="dashboard" params={{ vista: "resumen" }} className="shrink-0" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title={`Clases de ${act.nombre}`} value={r.sep_total} hint={esHistorial ? "en el ciclo" : "por asignar"} />
        <Card title="Con docente asignado" value={`${r.asignados}`} hint={esHistorial ? `${pct}% · ya impartidas` : `${pct}% · ${r.confirmados} a mano, ${r.sugeridos} por revisar`} />
        <Card title="Sin docente" value={sinAsignar} hint="sin docente aún" />
        <Card title="Alertas" value={totalAlertas} hint="ver detalle" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-medium text-slate-700 mb-1">Alertas por tipo</h2>
          <p className="text-xs text-slate-400 mb-2">Toca cada tipo para ver qué significa y un ejemplo.</p>
          <AlertasPorTipo alertas={r.alertas} />
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
        <Sev s="alta" /> indica prioridad. Las sugerencias son automáticas; coordinación acepta o cambia cada materia.
      </p>
    </div>
  );
}
