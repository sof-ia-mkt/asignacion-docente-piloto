import { getDashCobertura } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";
import { Donut, GroupedBars, COLORS } from "@/lib/charts";
import { ExportButtons } from "@/lib/export-buttons";

export default async function CoberturaPage({
  searchParams,
}: { searchParams: Promise<{ plantel?: string }> }) {
  const plantel = (await searchParams).plantel ?? "";
  const { estados: e, porTipo, porTurno, porCuatri } = await getDashCobertura(plantel);
  const sinPropuesta = e.total - e.asignados;
  const pct = e.total ? Math.round((e.asignados / e.total) * 100) : 0;
  const series = [
    { key: "n", label: "Total", color: COLORS.slate },
    { key: "asig", label: "Con propuesta", color: COLORS.blue },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButtons tipo="dashboard" params={{ vista: "cobertura", plantel }} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Total de clases" value={e.total} />
        <Card title="Con propuesta de asignación" value={`${e.asignados}`} hint={`${pct}% del total`} />
        <Card title="Sin propuesta" value={sinPropuesta} />
        <Card title="Aprobadas" value={e.confirmados} hint={`${e.sugeridos} propuestas a revisión`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Con propuesta vs sin propuesta">
          <Donut data={[
            { name: "Con propuesta", value: e.asignados, color: COLORS.blue },
            { name: "Sin propuesta", value: sinPropuesta, color: COLORS.red },
          ]} />
        </Panel>
        <Panel title="Embudo de estados">
          <Donut data={[
            { name: "Aprobadas", value: e.confirmados, color: COLORS.green },
            { name: "A revisión (propuestas)", value: e.sugeridos, color: COLORS.blue },
            { name: "Sin propuesta", value: sinPropuesta, color: COLORS.red },
          ]} />
        </Panel>
      </div>

      <Panel title="Cobertura por tipo de clase">
        <GroupedBars data={porTipo} xKey="tipo" series={series} />
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Cobertura por turno">
          <GroupedBars data={porTurno} xKey="turno" series={series} />
        </Panel>
        <Panel title="Cobertura por cuatrimestre">
          <GroupedBars data={porCuatri} xKey="cuatrimestre" series={series} />
        </Panel>
      </div>
    </div>
  );
}
