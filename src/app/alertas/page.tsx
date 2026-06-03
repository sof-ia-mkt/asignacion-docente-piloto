import Link from "next/link";
import { getAlertas, getAlertasResumen, getPlanteles } from "@/lib/queries";
import { Sev, tipoLabel, plantelCorto } from "@/lib/ui";
import { recalcularAlertasManual } from "@/app/actions";

// Orden de las tarjetas: lo accionable primero, "Sin aula" al final.
const TIPOS_ORDEN = ["sin_candidato", "choque_horario", "traslado_plantel", "sobrecarga", "docente_repetido", "sin_aula"];

// Texto que la plataforma muestra para explicar cada tipo de alerta — pensado para
// que coordinación entienda (y pueda explicar en demo) qué detecta cada una.
// La clave está en distinguir CHOQUE (el reloj) de TRASLADO (el mapa).
const EXPLICA: { tipo: string; idea: string; texto: string }[] = [
  { tipo: "sin_candidato", idea: "Nadie la puede dar",
    texto: "Ninguna persona del catálogo tiene historial ni CV que respalde esa materia. Hay que buscar docente o revisar el plan." },
  { tipo: "choque_horario", idea: "El reloj — misma hora",
    texto: "El mismo docente quedó con dos clases que se enciman en el horario (ej. lunes 10:00–12:00 en dos grupos). No puede estar en dos aulas al mismo tiempo." },
  { tipo: "traslado_plantel", idea: "El mapa — distinto campus",
    texto: "El docente tiene dos clases el mismo día, a horas distintas (no se empalman), pero en planteles distintos sin tiempo suficiente para trasladarse (ej. Casa Blanca 10:00 → Tecate 10:30, imposible). Severidad alta = menos de 60 min entre campus." },
  { tipo: "sobrecarga", idea: "Demasiadas clases",
    texto: "El docente acumula muchos slots en la semana. Conviene repartir la carga para que sea realista." },
  { tipo: "docente_repetido", idea: "Concentración en una persona",
    texto: "Una misma persona quedó asignada a muchos grupos. No es un error, pero conviene revisar si depende demasiado de un solo docente." },
  { tipo: "sin_aula", idea: "Falta espacio",
    texto: "La materia tiene docente pero todavía no tiene aula asignada para impartirse." },
];
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
        {/* Las alertas se recalculan solas tras cada edición; este botón es por si quieres forzar el refresco. */}
        <form action={recalcularAlertasManual}>
          <button className="shrink-0 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">
            Recalcular alertas
          </button>
        </form>
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
            La diferencia más fina es <strong>Choque de horario</strong> (mismo docente, misma hora)
            frente a <strong>Traslado entre planteles</strong> (mismo docente, horas distintas pero campus distintos sin tiempo de moverse).
          </p>
          <dl className="grid md:grid-cols-2 gap-3">
            {EXPLICA.map((e) => (
              <div key={e.tipo} className="rounded-md border border-slate-100 bg-slate-50/60 p-3">
                <dt className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-slate-800">{tipoLabel(e.tipo)}</span>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">{e.idea}</span>
                </dt>
                <dd className="text-xs text-slate-600 leading-relaxed">{e.texto}</dd>
              </div>
            ))}
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
