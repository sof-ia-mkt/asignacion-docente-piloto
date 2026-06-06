import Link from "next/link";
import { getSlotsSeptiembre, getPlanteles, contarSugeridas, getFacetasSlots, getConteoPorEstado } from "@/lib/queries";
import { Estado, TipoClase, planCorto, plantelCorto } from "@/lib/ui";
import { confirmarSugeridas } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";
import { ExportButtons } from "@/lib/export-buttons";
import { AsignacionFiltros } from "./filtros";

export default async function AsignacionPage({
  searchParams,
}: { searchParams: Promise<{ estado?: string; q?: string; plantel?: string; cuatri?: string; tipo?: string; page?: string }> }) {
  const sp = await searchParams;
  const estado = sp.estado ?? "";
  const qstr = sp.q ?? "";
  const plantel = sp.plantel ?? "";
  const cuatri = sp.cuatri ?? "";
  const tipo = sp.tipo ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const [{ rows, total, pages, limit }, planteles, sugeridas, facetas, conteo] = await Promise.all([
    getSlotsSeptiembre({ estado, q: qstr, plantel, cuatri, tipo, page }),
    getPlanteles(),
    contarSugeridas(plantel),
    getFacetasSlots(plantel),
    getConteoPorEstado({ q: qstr, plantel, cuatri, tipo }),
  ]);
  const ambito = plantel ? plantelCorto(plantel) : "todos los planteles";

  // Construye un href de /asignacion conservando los filtros actuales y cambiando uno.
  // Al cambiar cualquier filtro se vuelve a la página 1 (salvo que se cambie 'page').
  const href = (cambios: Record<string, string>) => {
    const base = {
      ...(estado ? { estado } : {}), ...(qstr ? { q: qstr } : {}), ...(plantel ? { plantel } : {}),
      ...(cuatri ? { cuatri } : {}), ...(tipo ? { tipo } : {}), ...(page > 1 ? { page: String(page) } : {}),
    };
    const merged = { ...base, ...cambios };
    if (!("page" in cambios)) delete (merged as Record<string, string>).page;
    const limpio = Object.fromEntries(Object.entries(merged).filter(([, val]) => val));
    const qsParams = new URLSearchParams(limpio).toString();
    return `/asignacion${qsParams ? `?${qsParams}` : ""}`;
  };
  const chip = (activo: boolean) =>
    `px-3 py-1.5 rounded-md text-sm border ${activo ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Asignación de septiembre</h1>
          <p className="text-sm text-slate-500">
            {total} materias por grupo{plantel ? ` en ${plantelCorto(plantel)}` : " (todos los planteles)"}. Sin asignar aparecen primero.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportButtons tipo="asignacion" params={{ estado, q: qstr, plantel, cuatri, tipo }} />
          {sugeridas > 0 && (
            <form action={confirmarSugeridas.bind(null, plantel || undefined)}>
              <ConfirmButton
                message={`¿Confirmar las ${sugeridas} sugerencias del sistema en ${ambito}? Quedarán como "Confirmada" (revisadas por coordinación). Podrás cambiar cualquiera después.`}
                className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm whitespace-nowrap hover:bg-green-700">
                Confirmar {sugeridas} sugerida{sugeridas === 1 ? "" : "s"}
              </ConfirmButton>
            </form>
          )}
          <Link href="/asignacion/nueva" className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm whitespace-nowrap">
            + Nueva materia por grupo
          </Link>
        </div>
      </div>

      <AsignacionFiltros
        estado={estado} plantel={plantel} cuatri={cuatri} tipo={tipo} qstr={qstr}
        planteles={planteles} cuatris={facetas.cuatris} tipos={facetas.tipos} conteo={conteo} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Plantel</th>
              <th className="px-4 py-2 font-medium">Materia</th>
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 font-medium">Cuatri</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Grupo</th>
              <th className="px-4 py-2 font-medium text-right">Alumnos</th>
              <th className="px-4 py-2 font-medium">Aula</th>
              <th className="px-4 py-2 font-medium">Horario</th>
              <th className="px-4 py-2 font-medium">Docente</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-500">{plantelCorto(s.plantel)}</td>
                <td className="px-4 py-2 text-slate-800">{s.materia ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{planCorto(s.plan)}</td>
                <td className="px-4 py-2 text-slate-600">{s.cuatrimestre ?? "—"}</td>
                <td className="px-4 py-2"><TipoClase t={s.tipo} /></td>
                <td className="px-4 py-2 text-slate-600">{s.grupo ?? "—"}</td>
                <td className="px-4 py-2 text-right text-slate-600">{s.alumnos ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2 text-slate-600">{s.aula ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2 text-slate-600">{s.dia && s.dia !== "N/A" && s.hora_inicio && s.hora_fin ? `${s.dia} ${s.hora_inicio}-${s.hora_fin}` : <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2 text-slate-700">{s.docente ?? <span className="text-slate-400">sin docente</span>}</td>
                <td className="px-4 py-2"><Estado e={s.estado} /></td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/asignacion/${s.id}`} className="text-blue-700 hover:underline">Revisar</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-400">
          {total === 0
            ? "Sin resultados con estos filtros."
            : `Mostrando ${(page - 1) * limit + 1}–${(page - 1) * limit + rows.length} de ${total}.`}
        </p>
        {pages > 1 && (
          <nav className="flex items-center gap-1 text-sm">
            {page > 1 && (
              <Link href={href({ page: String(page - 1) })}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                ← Anterior
              </Link>
            )}
            {paginas(page, pages).map((p, i) =>
              p === "…" ? (
                <span key={`g${i}`} className="px-2 text-slate-400">…</span>
              ) : (
                <Link key={p} href={href({ page: String(p) })} className={chip(p === page) + " px-3 py-1.5"}>
                  {p}
                </Link>
              ),
            )}
            {page < pages && (
              <Link href={href({ page: String(page + 1) })}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                Siguiente →
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

// Lista compacta de páginas con elipsis: 1 … (p-1) p (p+1) … N.
function paginas(actual: number, total: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  const push = (n: number) => { if (!out.includes(n) && n >= 1 && n <= total) out.push(n); };
  const cerca = [actual - 1, actual, actual + 1];
  const orden = [1, ...cerca, total].filter((n, i, a) => a.indexOf(n) === i && n >= 1 && n <= total).sort((a, b) => a - b);
  let prev = 0;
  for (const n of orden) {
    if (n - prev > 1) out.push("…");
    push(n);
    prev = n;
  }
  return out;
}
