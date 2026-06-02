import { getDashDocentes } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";
import { CBars, HBars, COLORS } from "@/lib/charts";

export default async function DocentesDashPage() {
  const { resumen, hist, top, sinAsignar } = await getDashDocentes();
  const histData = [
    { rango: "1–3", n: hist.b1, color: COLORS.green },
    { rango: "4–6", n: hist.b2, color: COLORS.blue },
    { rango: "7–12", n: hist.b3, color: COLORS.amber },
    { rango: "13+", n: hist.b4, color: COLORS.red },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Docentes con carga" value={resumen.docentes} />
        <Card title="Carga promedio" value={resumen.avgc} hint="slots / docente" />
        <Card title="Carga máxima" value={resumen.maxc} hint="slots" />
        <Card title="Sobrecargados" value={resumen.sobre} hint=">12 slots" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Distribución de carga (docentes por rango de slots)">
          <CBars data={histData} xKey="rango" valueKey="n" />
        </Panel>
        <Panel title="Top 10 más cargados">
          <HBars data={top} labelKey="nombre" valueKey="carga" color={COLORS.amber} />
        </Panel>
      </div>

      <Panel title={`Docentes sin asignación (${sinAsignar.length})`}>
        {sinAsignar.length === 0 ? (
          <p className="text-sm text-slate-400">Todos los docentes asignables tienen al menos un slot.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sinAsignar.map((d) => (
              <li key={d.nombre} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs">{d.nombre}</li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
