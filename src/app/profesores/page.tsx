import Link from "next/link";
import { getProfesores, getProfesoresConteo } from "@/lib/queries";
import { nombresCoordinadores } from "@/lib/usuarios-db";
import { ExportButtons } from "@/lib/export-buttons";
import { TablaProfesores } from "./tabla";

const FILTROS = [
  { v: "", label: "Todos" },
  { v: "cv", label: "Con CV" },
  { v: "sincv", label: "Sin CV" },
];

export default async function ProfesoresPage({
  searchParams,
}: { searchParams: Promise<{ cv?: string; coord?: string }> }) {
  const sp = await searchParams;
  const cvRaw = sp.cv ?? "";
  const cv = (cvRaw === "cv" || cvRaw === "sincv" ? cvRaw : "") as "" | "cv" | "sincv";
  const coordinadores = await nombresCoordinadores();
  const coord = coordinadores.includes(sp.coord ?? "") ? (sp.coord as string) : "";
  const [profes, conteo] = await Promise.all([getProfesores(cv, coord), getProfesoresConteo()]);
  const sinCv = conteo.total - conteo.con_cv;

  // Construye un href conservando los filtros que no se están cambiando.
  const href = (next: { cv?: string; coord?: string }) => {
    const params = new URLSearchParams();
    const c = next.cv ?? cv, k = next.coord ?? coord;
    if (c) params.set("cv", c);
    if (k) params.set("coord", k);
    const qs = params.toString();
    return qs ? `/profesores?${qs}` : "/profesores";
  };

  const chip = (activo: boolean) =>
    `px-3 py-1.5 rounded-md text-sm border ${activo ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Profesores</h1>
          <p className="text-sm text-slate-500">
            {conteo.total} docentes en total · {conteo.con_cv} con CV leído · {sinCv} solo con historial.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportButtons tipo="profesores" params={{ cv, coord }} />
          <Link href="/profesores/nuevo"
            className="px-3 py-2 rounded-md bg-slate-900 text-white text-sm">
            + Nuevo docente
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 items-center">
        {FILTROS.map((f) => (
          <Link key={f.v} href={href({ cv: f.v })} className={chip(cv === f.v)}>
            {f.label}
          </Link>
        ))}
        <span className="mx-2 h-5 w-px bg-slate-200" aria-hidden />
        <span className="text-xs text-slate-400 mr-1">Coordinación:</span>
        <Link href={href({ coord: "" })} className={chip(coord === "")}>Todas</Link>
        {coordinadores.map((c) => (
          <Link key={c} href={href({ coord: c })} className={chip(coord === c)}>{c}</Link>
        ))}
      </div>

      <TablaProfesores profes={profes} />
    </div>
  );
}
