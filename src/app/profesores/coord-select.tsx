"use client";

import { useRouter } from "next/navigation";

// Selector compacto de coordinación. Navega a /profesores?coord=... conservando el filtro de CV.
export function CoordSelect({
  coordinadores, coord, cv,
}: { coordinadores: string[]; coord: string; cv: string }) {
  const router = useRouter();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams();
    if (cv) params.set("cv", cv);
    if (e.target.value) params.set("coord", e.target.value);
    const qs = params.toString();
    router.push(qs ? `/profesores?${qs}` : "/profesores");
  };

  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-xs text-slate-400">Coordinación:</span>
      <select
        value={coord}
        onChange={onChange}
        className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
        <option value="">Todas</option>
        {coordinadores.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}
