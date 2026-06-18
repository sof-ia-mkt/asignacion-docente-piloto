import Link from "next/link";
import { getDashRiesgos } from "@/lib/queries";
import { Card, Panel, tipoLabel } from "@/lib/ui";
import { CBars, HBars, COLORS } from "@/lib/charts";
import { ExportButtons } from "@/lib/export-buttons";

const SEV_COLOR: Record<string, string> = { alta: COLORS.red, media: COLORS.amber, baja: COLORS.slate };

export default async function RiesgosPage({
  searchParams,
}: { searchParams: Promise<{ plantel?: string }> }) {
  const plantel = (await searchParams).plantel ?? "";
  const { porTipo, materiasSinCand } = await getDashRiesgos(plantel);
  // Suma por tipo (combina severidades) y toma el color de la severidad más alta presente.
  const byTipo = new Map<string, { tipo: string; n: number; sev: string }>();
  for (const r of porTipo) {
    const cur = byTipo.get(r.tipo) ?? { tipo: tipoLabel(r.tipo), n: 0, sev: "baja" };
    cur.n += r.n;
    if (r.severidad === "alta" || (r.severidad === "media" && cur.sev !== "alta")) cur.sev = r.severidad;
    byTipo.set(r.tipo, cur);
  }
  const tipoData = [...byTipo.values()]
    .sort((a, b) => b.n - a.n)
    .map((t) => ({ tipo: t.tipo, n: t.n, color: SEV_COLOR[t.sev] }));
  const total = tipoData.reduce((a, x) => a + x.n, 0);
  // "Prioridad alta" = alertas individuales con severidad 'alta' (mismo criterio que Inicio y Alertas).
  // OJO: no contar por tipo (un tipo puede mezclar altas y medias), si no el número se infla.
  const altas = porTipo.filter((r) => r.severidad === "alta").reduce((a, x) => a + x.n, 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButtons tipo="dashboard" params={{ vista: "riesgos", plantel }} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Alertas totales" value={total} />
        <Card title="Prioridad alta" value={altas} />
        <Card title="Materias sin candidato" value={materiasSinCand.reduce((a, x) => a + x.n, 0)} hint="grupos afectados" />
        <Card title="Tipos de alerta" value={tipoData.length} />
      </div>

      <Panel title="Alertas por tipo (color = severidad)">
        <CBars data={tipoData} xKey="tipo" valueKey="n" />
      </Panel>

      <Panel title="Materias críticas — en más grupos sin candidato fuerte">
        {materiasSinCand.length === 0 ? (
          <p className="text-sm text-slate-400">Sin materias críticas.</p>
        ) : (
          <HBars data={materiasSinCand} labelKey="materia" valueKey="n" color={COLORS.red} height={380} />
        )}
        <p className="mt-3 text-xs text-slate-400">
          Estas materias no tienen candidato fuerte (ni historial ni CV alto). Son las primeras a cubrir con contratación o cargando más CVs.
          Revisa el detalle en <Link href="/alertas" className="text-blue-700 hover:underline">Alertas</Link>.
        </p>
      </Panel>
    </div>
  );
}
