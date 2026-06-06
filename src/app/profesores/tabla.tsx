"use client";
// Tabla de profesores con buscador instantáneo por nombre.
// La lista completa llega como prop desde el server component (son pocas decenas de
// docentes, ya vienen cargados), así que el filtrado es en el cliente: se escribe y
// la tabla se reduce al instante, sin recargar la página.
import { useMemo, useState } from "react";
import Link from "next/link";
import { plantelCorto, PropuestaEstado } from "@/lib/ui";

export type ProfesorFila = {
  id: number;
  nombre: string;
  anios_experiencia: number | null;
  licenciatura: string | null;
  coordinador: string | null;
  tiene_cv: boolean;
  n_cand: number;
  n_asig: number;
  planteles: string | null;
  propuesta_estado: string;
};

// Quita acentos y pasa a minúsculas para que "jose" encuentre "JOSÉ".
const normaliza = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export function TablaProfesores({ profes }: { profes: ProfesorFila[] }) {
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const t = normaliza(busca);
    if (!t) return profes;
    // Cada palabra escrita debe aparecer en el nombre (en cualquier orden).
    const terminos = t.split(/\s+/).filter(Boolean);
    return profes.filter((p) => {
      const n = normaliza(p.nombre);
      return terminos.every((term) => n.includes(term));
    });
  }, [busca, profes]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar docente por nombre…"
            autoComplete="off"
            className="w-full pl-9 pr-8 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden>⌕</span>
          {busca && (
            <button
              type="button"
              onClick={() => setBusca("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
              aria-label="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>
        {busca && (
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {filtrados.length} de {profes.length}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Docente</th>
              <th className="px-4 py-2 font-medium">Propuesta</th>
              <th className="px-4 py-2 font-medium">Coordinación</th>
              <th className="px-4 py-2 font-medium">CV</th>
              <th className="px-4 py-2 font-medium">Plantel(es)</th>
              <th className="px-4 py-2 font-medium">Licenciatura</th>
              <th className="px-4 py-2 font-medium text-right">Exp.</th>
              <th className="px-4 py-2 font-medium text-right">Materias candidatas</th>
              <th className="px-4 py-2 font-medium text-right">Asignadas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtrados.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/profesores/${p.id}`} className="text-blue-700 hover:underline font-medium">
                    {p.nombre}
                  </Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <PropuestaEstado e={p.propuesta_estado} />
                </td>
                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                  {p.coordinador ?? <span className="text-amber-700 text-xs">sin asignar</span>}
                </td>
                <td className="px-4 py-2">
                  {p.tiene_cv ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-green-100 text-green-800 border-green-200">CV</span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-slate-100 text-slate-500 border-slate-200">historial</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                  {p.planteles
                    ? [...new Set(p.planteles.split(",").filter(Boolean).map(plantelCorto))].join(", ")
                    : "—"}
                </td>
                <td className="px-4 py-2 text-slate-600">{p.licenciatura ?? "—"}</td>
                <td className="px-4 py-2 text-right text-slate-600">{p.anios_experiencia ?? "—"}</td>
                <td className="px-4 py-2 text-right">{p.n_cand}</td>
                <td className="px-4 py-2 text-right">{p.n_asig}</td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-400">
                  {profes.length === 0
                    ? "Sin docentes con este filtro."
                    : `Ningún docente coincide con “${busca}”.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
