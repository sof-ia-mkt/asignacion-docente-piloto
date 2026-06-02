import { getDashCobertura } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";
import { Donut, GroupedBars, COLORS } from "@/lib/charts";

export default async function CoberturaPage({
  searchParams,
}: { searchParams: Promise<{ plantel?: string }> }) {
  const plantel = (await searchParams).plantel ?? "";
  const { estados: e, porTipo, porTurno, porCuatri } = await getDashCobertura(plantel);
  const sinAsignar = e.total - e.asignados;
  const pct = e.total ? Math.round((e.asignados / e.total) * 100) : 0;
  const series = [
    { key: "n", label: "Total", color: COLORS.slate },
    { key: "asig", label: "Con docente", color: COLORS.green },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Total de clases" value={e.total} />
        <Card title="Con docente propuesto" value={`${e.asignados}`} hint={`${pct}% · falta confirmar`} />
        <Card title="Sin docente" value={sinAsignar} />
        <Card title="Confirmadas" value={e.confirmados} hint={`${e.sugeridos} por revisar`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Con docente vs sin docente">
          <Donut data={[
            { name: "Con docente", value: e.asignados, color: COLORS.green },
            { name: "Sin docente", value: sinAsignar, color: COLORS.red },
          ]} />
        </Panel>
        <Panel title="Embudo de estados">
          <Donut data={[
            { name: "Confirmadas", value: e.confirmados, color: COLORS.green },
            { name: "Sugeridas (sin revisar)", value: e.sugeridos, color: COLORS.blue },
            { name: "Sin docente", value: sinAsignar, color: COLORS.red },
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
