import { getDashRecomendacion } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";
import { Donut, CBars, COLORS } from "@/lib/charts";
import { ExportButtons } from "@/lib/export-buttons";

export default async function RecomendacionPage({
  searchParams,
}: { searchParams: Promise<{ plantel?: string }> }) {
  const plantel = (await searchParams).plantel ?? "";
  const { origen, calidad, cv } = await getDashRecomendacion(plantel);
  const totalAsig = origen.reduce((a, x) => a + x.n, 0);
  const conCV = origen.filter((o) => o.origen !== "Solo historial").reduce((a, x) => a + x.n, 0);
  const ORIGEN_COLOR: Record<string, string> = {
    "Solo historial": COLORS.blue, "Historial + CV": COLORS.violet, "Solo CV": COLORS.green,
  };
  const cvData = [
    { etiqueta: "Con CV", n: cv.procesados, color: COLORS.green },
    { etiqueta: "Sin CV", n: Math.max(cv.asignables - cv.procesados, 0), color: COLORS.slate },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButtons tipo="dashboard" params={{ vista: "recomendacion", plantel }} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Asignaciones" value={totalAsig} />
        <Card title="Apoyadas en CV" value={conCV} hint={`${totalAsig ? Math.round((conCV / totalAsig) * 100) : 0}% del total`} />
        <Card title="Puntaje promedio" value={calidad.puntaje_avg} hint="fuerza de la recomendación" />
        <Card title="Asignadas a mano" value={calidad.confirmadas} hint={`${calidad.automaticas} automáticas`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Origen de cada asignación">
          <Donut data={origen.map((o) => ({ name: o.origen, value: o.n, color: ORIGEN_COLOR[o.origen] }))} />
        </Panel>
        <Panel title="Docentes con CV procesado">
          <CBars data={cvData} xKey="etiqueta" valueKey="n" />
        </Panel>
      </div>

      <Panel>
        <p className="text-sm text-slate-600">
          Hoy la recomendación se apoya casi toda en el <b>historial real</b> (lo que cada docente ya dio en
          ciclos anteriores: la señal más fuerte). El <b>CV</b> aporta a {conCV} de {totalAsig} asignaciones.
          Procesar más CVs ampliaría la cobertura hacia materias nuevas o docentes sin historial — ese es el
          margen de crecimiento de la parte de IA.
        </p>
      </Panel>
    </div>
  );
}
