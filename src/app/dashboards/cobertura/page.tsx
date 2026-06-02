import { getDashCobertura } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";
import { Donut, GroupedBars, COLORS } from "@/lib/charts";

export default async function CoberturaPage() {
  const { estados: e, porTipo, porTurno, porCuatri } = await getDashCobertura();
  const sinAsignar = e.total - e.asignados;
  const pct = e.total ? Math.round((e.asignados / e.total) * 100) : 0;
  const series = [
    { key: "n", label: "Total", color: COLORS.slate },
    { key: "asig", label: "Asignados", color: COLORS.green },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Total slots" value={e.total} />
        <Card title="Asignados" value={`${e.asignados}`} hint={`${pct}%`} />
        <Card title="Sin asignar" value={sinAsignar} />
        <Card title="Confirmados" value={e.confirmados} hint={`${e.sugeridos} sugeridos`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Asignado vs sin asignar">
          <Donut data={[
            { name: "Asignados", value: e.asignados, color: COLORS.green },
            { name: "Sin asignar", value: sinAsignar, color: COLORS.red },
          ]} />
        </Panel>
        <Panel title="Embudo de estados">
          <Donut data={[
            { name: "Confirmados", value: e.confirmados, color: COLORS.green },
            { name: "Sugeridos (sin revisar)", value: e.sugeridos, color: COLORS.blue },
            { name: "Sin asignar", value: sinAsignar, color: COLORS.red },
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
