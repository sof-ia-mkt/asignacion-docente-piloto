import Link from "next/link";
import { getAlertas, getAlertasResumen, getPlanteles } from "@/lib/queries";
import { Sev, tipoLabel, plantelCorto } from "@/lib/ui";

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
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Alertas</h1>
        <p className="text-sm text-slate-500">
          {alertas.length} mostradas{tipo ? ` · ${tipoLabel(tipo)}` : ""}
          {plantel ? ` · ${plantelCorto(plantel)}` : ""}
          {" · "}{totalScope} en total{plantel ? ` en ${plantelCorto(plantel)}` : ""}.
        </p>
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

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Severidad</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Plantel</th>
              <th className="px-4 py-2 font-medium">Detalle</th>
              <th className="px-4 py-2 font-medium">Docente</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {alertas.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50 align-top">
                <td className="px-4 py-2"><Sev s={a.severidad} /></td>
                <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{tipoLabel(a.tipo)}</td>
                <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{a.plantel ? plantelCorto(a.plantel) : "—"}</td>
                <td className="px-4 py-2 text-slate-600">{a.detalle}</td>
                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                  {a.profesor_id ? (
                    <Link href={`/profesores/${a.profesor_id}`} className="text-blue-700 hover:underline">{a.profesor ?? "ver"}</Link>
                  ) : "—"}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {a.slot_id && (
                    <Link href={`/asignacion/${a.slot_id}`} className="text-blue-700 hover:underline">Revisar</Link>
                  )}
                </td>
              </tr>
            ))}
            {alertas.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">Sin alertas con estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
