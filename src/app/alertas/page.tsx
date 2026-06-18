import Link from "next/link";
import { getAlertas, getAlertasResumen, getPlanteles } from "@/lib/queries";
import { tipoLabel, plantelCorto, ALERTA_INFO } from "@/lib/ui";
import { recalcularAlertasManual } from "@/app/actions";
import { ExportButtons } from "@/lib/export-buttons";
import { TablaAlertas } from "./tabla";

// Orden de las tarjetas: lo accionable primero, "Sin aula" al final.
const TIPOS_ORDEN = ["sin_candidato", "choque_horario", "traslado_plantel", "sobrecarga", "docente_repetido", "sin_aula"];

const SEVERIDADES = [
  { v: "alta", label: "Alta" },
  { v: "media", label: "Media" },
  { v: "todas", label: "Todas" },
];

export default async function AlertasPage({
  searchParams,
}: { searchParams: Promise<{ tipo?: string; severidad?: string; plantel?: string }> }) {
  const sp = await searchParams;
  const tipo = sp.tipo ?? "";
  const sevParam = sp.severidad ?? "alta"; // por defecto solo lo urgente
  const severidad = sevParam === "todas" ? "" : sevParam;
  const plantel = sp.plantel ?? "";

  const [alertas, resumen, planteles] = await Promise.all([
    getAlertas({ tipo, severidad, plantel }),
    getAlertasResumen(plantel),
    getPlanteles(),
  ]);
  const conteo = new Map(resumen.map((r) => [r.tipo, r.n]));
  const totalScope = resumen.reduce((s, r) => s + r.n, 0);

  // href de /alertas conservando filtros y cambiando uno (severidad=alta es el default implícito).
  const href = (cambios: Record<string, string>) => {
    const base = {
      ...(tipo ? { tipo } : {}),
      ...(sevParam !== "alta" ? { severidad: sevParam } : {}),
      ...(plantel ? { plantel } : {}),
    };
    const merged = { ...base, ...cambios };
    const limpio = Object.fromEntries(Object.entries(merged).filter(([, v]) => v));
    const qs = new URLSearchParams(limpio).toString();
    return `/alertas${qs ? `?${qs}` : ""}`;
  };
  const chip = (activo: boolean) =>
    `px-3 py-1.5 rounded-md text-sm border ${activo ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Alertas</h1>
          <p className="text-sm text-slate-500">
            {alertas.length} mostradas{tipo ? ` · ${tipoLabel(tipo)}` : ""}
            {plantel ? ` · ${plantelCorto(plantel)}` : ""}
            {" · "}{totalScope} en total{plantel ? ` en ${plantelCorto(plantel)}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportButtons tipo="alertas" params={{ tipo, severidad: sevParam, plantel }} />
          {/* Las alertas se recalculan solas tras cada edición; este botón es por si quieres forzar el refresco. */}
          <form action={recalcularAlertasManual}>
            <button className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">
              Recalcular alertas
            </button>
          </form>
        </div>
      </div>

      {/* Tarjetas por tipo: clic = ver todas las de ese tipo */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {TIPOS_ORDEN.map((t) => {
          const n = conteo.get(t) ?? 0;
          const activo = tipo === t;
          return (
            <Link
              key={t}
              href={activo ? href({ tipo: "" }) : href({ tipo: t, severidad: "todas" })}
              className={`rounded-lg border p-3 ${activo ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className={`text-2xl font-semibold ${n === 0 ? "text-slate-300" : ""}`}>{n}</div>
              <div className={`text-xs ${activo ? "text-slate-200" : "text-slate-500"}`}>{tipoLabel(t)}</div>
            </Link>
          );
        })}
      </div>

      {/* Explicación de cada tipo — colapsable para no estorbar, abierta con un clic en demo. */}
      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">
          ¿Qué significa cada alerta?
        </summary>
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          <p className="text-xs text-slate-500">
            Las alertas no son errores: son focos para revisar antes de cerrar el cuatrimestre.
            La diferencia más fina es <strong>Sin maestro por horario</strong> (la clase quedó sin docente porque su candidato ya da otra a esa misma hora)
            frente a <strong>Traslado entre planteles</strong> (mismo docente, horas distintas pero campus distintos sin tiempo de moverse).
          </p>
          <dl className="grid md:grid-cols-2 gap-3">
            {TIPOS_ORDEN.map((t) => {
              const info = ALERTA_INFO[t];
              if (!info) return null;
              return (
                <div key={t} className="rounded-md border border-slate-100 bg-slate-50/60 p-3">
                  <dt className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-800">{tipoLabel(t)}</span>
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">{info.idea}</span>
                  </dt>
                  <dd className="text-xs text-slate-600 leading-relaxed">
                    {info.que}
                    <span className="mt-1 block italic text-slate-500">{info.ejemplo}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </details>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 items-center">
          <span className="text-xs text-slate-400 mr-1">Severidad:</span>
          {SEVERIDADES.map((s) => (
            <Link key={s.v} href={href({ severidad: s.v })} className={chip(sevParam === s.v)}>{s.label}</Link>
          ))}
        </div>
        <div className="flex gap-1 items-center">
          <span className="text-xs text-slate-400 mr-1">Plantel:</span>
          <Link href={href({ plantel: "" })} className={chip(plantel === "")}>Todos</Link>
          {planteles.map((p) => (
            <Link key={p.plantel} href={href({ plantel: p.plantel })} className={chip(plantel === p.plantel)}>
              {plantelCorto(p.plantel)}
            </Link>
          ))}
        </div>
      </div>

      <TablaAlertas alertas={alertas} />
    </div>
  );
}
