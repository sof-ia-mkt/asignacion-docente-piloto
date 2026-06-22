import Link from "next/link";
import { getSlotsSeptiembre, getPlanteles, contarSugeridas, getFacetasSlots, getConteoPorEstado } from "@/lib/queries";
import { cicloActivo } from "@/lib/ciclo";
import { plantelCorto } from "@/lib/ui";
import { confirmarSugeridas } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";
import { ExportButtons } from "@/lib/export-buttons";
import { AsignacionFiltros } from "./filtros";
import { TablaAsignacion } from "./tabla-asignacion";

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
  const [{ rows, total, pages, limit }, planteles, sugeridas, facetas, conteo, act] = await Promise.all([
    getSlotsSeptiembre({ estado, q: qstr, plantel, cuatri, tipo, page }),
    getPlanteles(),
    contarSugeridas({ plantel, cuatri, tipo, q: qstr }),
    getFacetasSlots(plantel),
    getConteoPorEstado({ q: qstr, plantel, cuatri, tipo }),
    cicloActivo(),
  ]);
  // Texto que describe el alcance EXACTO del botón "Aceptar N sugeridas": los mismos filtros
  // que la lista. Así el coordinador sabe qué va a confirmar antes de apretar.
  const partesAmbito = [
    plantel ? plantelCorto(plantel) : null,
    cuatri ? `cuatri ${cuatri}` : null,
    tipo ? tipo : null,
    qstr ? `"${qstr}"` : null,
  ].filter(Boolean);
  const ambito = partesAmbito.length ? partesAmbito.join(", ") : "todos los planteles";

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Asignación · {act.nombre}</h1>
          <p className="text-sm text-slate-500">
            {total} materias por grupo{plantel ? ` en ${plantelCorto(plantel)}` : " (todos los planteles)"}. Sin propuesta aparecen primero.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportButtons tipo="asignacion" params={{ estado, q: qstr, plantel, cuatri, tipo }} />
          {sugeridas > 0 && (
            <form action={confirmarSugeridas.bind(null, {
              plantel: plantel || undefined, cuatri: cuatri || undefined,
              tipo: tipo || undefined, q: qstr || undefined,
            })}>
              <ConfirmButton
                message={`¿Aprobar las ${sugeridas} propuestas que estás viendo (${ambito})? Quedarán como "Aprobada" (revisadas por coordinación). Podrás cambiar cualquiera después.`}
                className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm whitespace-nowrap hover:bg-green-700">
                Aceptar {sugeridas} sugerida{sugeridas === 1 ? "" : "s"}
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

      <TablaAsignacion rows={rows} parked={estado === "no_apertura"} />
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
