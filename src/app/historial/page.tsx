import Link from "next/link";
import { getBitacora, getBitacoraResumen } from "@/lib/queries";
import { EntidadBadge, entidadLabel } from "@/lib/ui";
import { ExportButtons } from "@/lib/export-buttons";
import { esReversible } from "@/lib/revertir";
import { BotonDeshacer } from "./boton-deshacer";

// Orden de las entidades en las pastillas de filtro (lo más editado primero).
const ENTIDADES = ["docente", "clase", "aula", "asignacion", "candidatura", "cv"];
const ACCIONES = ["creó", "editó", "borró", "asignó", "quitó", "confirmó", "agregó", "procesó", "deshizo"];

const PER_PAGE = 100;

// Fecha/hora legible, en horario de Tijuana (el del piloto).
const fmt = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Tijuana",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
};

export default async function HistorialPage({
  searchParams,
}: { searchParams: Promise<{ entidad?: string; accion?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const entidad = sp.entidad ?? "";
  const accion = sp.accion ?? "";
  const qstr = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [data, resumen] = await Promise.all([
    getBitacora({ entidad, accion, q: qstr, page }, PER_PAGE),
    getBitacoraResumen(),
  ]);
  const { rows, total, pages } = data;
  const conteo = new Map(resumen.map((r) => [r.entidad, r.n]));
  const totalGlobal = resumen.reduce((s, r) => s + r.n, 0);

  // href conservando filtros y cambiando uno (resetea la página).
  const href = (cambios: Record<string, string>) => {
    const base = {
      ...(entidad ? { entidad } : {}),
      ...(accion ? { accion } : {}),
      ...(qstr ? { q: qstr } : {}),
    };
    const merged = { ...base, ...cambios };
    const limpio = Object.fromEntries(Object.entries(merged).filter(([, v]) => v));
    const q = new URLSearchParams(limpio).toString();
    return `/historial${q ? `?${q}` : ""}`;
  };
  const chip = (activo: boolean) =>
    `px-3 py-1.5 rounded-md text-sm border ${activo ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`;

  // href de paginación: conserva todos los filtros y solo cambia la página.
  const pageHref = (n: number) => {
    const limpio = Object.fromEntries(
      Object.entries({ entidad, accion, q: qstr, page: String(n) }).filter(([, v]) => v && v !== "1"),
    );
    const q = new URLSearchParams(limpio).toString();
    return `/historial${q ? `?${q}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Historial de modificaciones</h1>
          <p className="text-sm text-slate-500">
            Quién cambió qué y cuándo. {total} movimiento(s){entidad ? ` · ${entidadLabel(entidad)}` : ""}
            {accion ? ` · ${accion}` : ""}
            {" · "}{totalGlobal} en total.
          </p>
        </div>
        <ExportButtons tipo="historial" params={{ entidad, accion, q: qstr }} className="shrink-0" />
      </div>

      {/* Filtro por entidad: clic = ver solo los cambios de ese tipo de dato */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {ENTIDADES.map((e) => {
          const n = conteo.get(e) ?? 0;
          const activo = entidad === e;
          return (
            <Link
              key={e}
              href={activo ? href({ entidad: "" }) : href({ entidad: e })}
              className={`rounded-lg border p-3 ${activo ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className={`text-2xl font-semibold ${n === 0 ? "text-slate-300" : ""}`}>{n}</div>
              <div className={`text-xs ${activo ? "text-slate-200" : "text-slate-500"}`}>{entidadLabel(e)}</div>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 items-center flex-wrap">
          <span className="text-xs text-slate-400 mr-1">Acción:</span>
          <Link href={href({ accion: "" })} className={chip(accion === "")}>Todas</Link>
          {ACCIONES.map((a) => (
            <Link key={a} href={href({ accion: a })} className={chip(accion === a)}>{a}</Link>
          ))}
        </div>
        {/* Búsqueda libre en la descripción (GET para que quede en la URL y se pueda compartir). */}
        <form method="GET" className="flex gap-1 items-center ml-auto">
          {entidad && <input type="hidden" name="entidad" value={entidad} />}
          {accion && <input type="hidden" name="accion" value={accion} />}
          <input
            type="text"
            name="q"
            defaultValue={qstr}
            placeholder="Buscar en el detalle…"
            className="px-3 py-1.5 rounded-md border border-slate-200 text-sm w-56"
          />
          <button className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">
            Buscar
          </button>
          {qstr && (
            <Link href={href({ q: "" })} className="px-2 py-1.5 text-sm text-slate-500 hover:underline">Limpiar</Link>
          )}
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium whitespace-nowrap">Fecha y hora</th>
              <th className="px-3 py-2 font-medium">Quién</th>
              <th className="px-3 py-2 font-medium">Qué</th>
              <th className="px-3 py-2 font-medium">Acción</th>
              <th className="px-3 py-2 font-medium">Detalle</th>
              <th className="px-3 py-2 font-medium text-right">Deshacer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const reversible = esReversible(r.entidad, r.accion, r.entidad_id) && r.tiene_snapshot;
              return (
              <tr key={r.id} className="hover:bg-slate-50 align-top">
                <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{fmt(r.creado_en)}</td>
                <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{r.actor}</td>
                <td className="px-3 py-3"><EntidadBadge e={r.entidad} /></td>
                <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{r.accion}</td>
                <td className="px-3 py-3 text-slate-700">{r.descripcion}</td>
                <td className="px-3 py-3 text-right">
                  {reversible
                    ? <BotonDeshacer id={r.id} descripcion={r.descripcion} />
                    : <span className="text-xs text-slate-300">—</span>}
                </td>
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  Sin movimientos con estos filtros. El historial se irá llenando conforme coordinación haga cambios.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">← Anteriores</Link>
            )}
            {page < pages && (
              <Link href={pageHref(page + 1)} className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">Siguientes →</Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
