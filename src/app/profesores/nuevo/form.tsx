"use client";
import { useActionState, useState } from "react";
import { crearDocente, type CrearDocenteState } from "@/app/actions";

const input = "w-full px-3 py-2 rounded-md border border-slate-300 text-sm";
const label = "block text-sm font-medium text-slate-700 mb-1";

export function NuevoDocenteForm({ materias }: { materias: { id: number; nombre: string }[] }) {
  const [state, action, pending] = useActionState<CrearDocenteState, FormData>(crearDocente, {});
  const [camino, setCamino] = useState<"manual" | "cv">("manual");
  const [filtro, setFiltro] = useState("");

  const visibles = filtro
    ? materias.filter((m) => m.nombre.toLowerCase().includes(filtro.toLowerCase()))
    : materias;

  return (
    <form action={action} className="space-y-5 max-w-2xl">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={label}>Nombre completo *</label>
          <input name="nombre" required className={input} placeholder="Ej. María López Hernández" />
        </div>
        <div>
          <label className={label}>Años de experiencia *</label>
          <input name="anios_experiencia" required type="number" min="0" className={input} />
        </div>
        <div className="md:col-span-2">
          <label className={label}>Licenciatura *</label>
          <input name="licenciatura" required className={input} />
        </div>
        <div>
          <label className={label}>Maestría <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input name="maestria" className={input} />
        </div>
        <div>
          <label className={label}>Doctorado <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input name="doctorado" className={input} />
        </div>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4">
        <legend className="px-2 text-sm font-medium text-slate-700">¿Cómo definimos qué materias puede dar?</legend>
        <div className="flex flex-col gap-2 mt-1">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="camino" value="manual" checked={camino === "manual"}
              onChange={() => setCamino("manual")} className="mt-1" />
            <span><b>Ya ha dado materias con nosotros</b> — eliges de la lista del catálogo (gratis).</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="camino" value="cv" checked={camino === "cv"}
              onChange={() => setCamino("cv")} className="mt-1" />
            <span><b>No ha dado materias aún</b> — subes su CV y la plataforma lo lee (~$0.05).</span>
          </label>
        </div>

        {camino === "manual" ? (
          <div key="manual" className="mt-4">
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)}
              placeholder="Filtrar materias…" className={input + " mb-2"} />
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
              {visibles.map((m) => (
                <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" name="materias" value={m.id} />
                  <span>{m.nombre}</span>
                </label>
              ))}
              {visibles.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Sin coincidencias.</p>}
            </div>
            <p className="mt-1 text-xs text-slate-400">Marca todas las materias que ya impartió. Cuentan como recomendación más fuerte (+40).</p>
          </div>
        ) : (
          <div key="cv" className="mt-4">
            <input type="file" name="cv" accept="application/pdf"
              className="block text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-slate-900 file:text-white" />
            <p className="mt-1 text-xs text-slate-400">PDF del CV. Claude lo lee una sola vez (~$0.05) y deduce sus materias candidatas.</p>
          </div>
        )}
      </fieldset>

      {state.error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <button disabled={pending} className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">
          {pending ? (camino === "cv" ? "Leyendo CV…" : "Guardando…") : "Dar de alta"}
        </button>
        {pending && camino === "cv" && <span className="text-xs text-slate-500">Puede tardar unos segundos.</span>}
      </div>
    </form>
  );
}
