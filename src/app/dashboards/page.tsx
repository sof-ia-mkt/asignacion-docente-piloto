import Link from "next/link";
import { getDashCobertura, getDashDocentes, getDashRiesgos, getDashRecomendacion } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";
import { Donut } from "@/lib/charts";

export default async function DashboardsHome({
  searchParams,
}: { searchParams: Promise<{ plantel?: string }> }) {
  const plantel = (await searchParams).plantel ?? "";
  const [cob, doc, rie, rec] = await Promise.all([
    getDashCobertura(plantel), getDashDocentes(plantel), getDashRiesgos(plantel), getDashRecomendacion(plantel),
  ]);
  const e = cob.estados;
  const sinAsignar = e.total - e.asignados;
  const pct = e.total ? Math.round((e.asignados / e.total) * 100) : 0;
  const totalAlertas = rie.porTipo.reduce((a, x) => a + x.n, 0);
  const altas = rie.porTipo.filter((x) => x.severidad === "alta").reduce((a, x) => a + x.n, 0);

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Vista general del ciclo de septiembre. Entra a cada monitor para el detalle.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Clases de septiembre" value={e.total} hint="por asignar y confirmar" />
        <Card title="Con docente propuesto" value={`${pct}%`} hint={`${e.asignados} clases · falta confirmar`} />
        <Card title="Sin docente" value={sinAsignar} hint="nadie propuesto aún" />
        <Card title="Confirmadas" value={e.confirmados} hint={`${e.sugeridos} aún por revisar`} />
        <Card title="Docentes con carga" value={doc.resumen.docentes} hint={`promedio ${doc.resumen.avgc} materias`} />
        <Card title="Sobrecargados" value={doc.resumen.sobre} hint=">12 materias" />
        <Card title="Alertas" value={totalAlertas} hint={`${altas} de prioridad alta`} />
        <Card title="CV procesados" value={rec.cv.procesados} hint={`de ${rec.cv.asignables} docentes`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Asignación de septiembre">
          <Donut data={[
            { name: "Con docente", value: e.asignados, color: "#16a34a" },
            { name: "Sin docente", value: sinAsignar, color: "#dc2626" },
          ]} />
        </Panel>
        <Panel title="Origen de la recomendación">
          <Donut data={rec.origen.map((o) => ({ name: o.origen, value: o.n }))} />
        </Panel>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {[
          { href: "/dashboards/cobertura", label: "Cobertura", hint: "por tipo, turno y cuatrimestre" },
          { href: "/dashboards/docentes", label: "Docentes", hint: "carga y equidad" },
          { href: "/dashboards/riesgos", label: "Riesgos", hint: "alertas y materias críticas" },
          { href: "/dashboards/recomendacion", label: "Recomendación", hint: "rol del historial y CV" },
        ].map((m) => (
          <Link key={m.href} href={m.href}
            className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400">
            <div className="font-medium text-slate-800">{m.label} →</div>
            <div className="text-xs text-slate-400 mt-1">{m.hint}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
