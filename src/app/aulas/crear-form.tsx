"use client";
import { useActionState, useRef, useEffect } from "react";
import { crearAula, type CrearAulaState } from "@/app/actions";

const input = "px-3 py-2 rounded-md border border-slate-300 text-sm";

export function CrearAulaForm({ tipos }: { tipos: string[] }) {
  const [state, action, pending] = useActionState<CrearAulaState, FormData>(crearAula, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Tras un alta exitosa (sin error y no enviando) limpiamos el formulario para capturar el siguiente.
  useEffect(() => {
    if (!pending && !state.error) formRef.current?.reset();
  }, [pending, state]);

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-xs text-slate-500 mb-1">Clave / nombre *</label>
        <input name="clave" required placeholder="Ej. A-204" className={input + " w-40"} />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Tipo</label>
        <input name="tipo" list="tipos-aula" placeholder="Teoría / Práctica…" className={input + " w-40"} />
        <datalist id="tipos-aula">{tipos.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Capacidad</label>
        <input name="capacidad" type="number" min="1" placeholder="ej. 40" className={input + " w-28"} />
      </div>
      <button disabled={pending} className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">
        {pending ? "Agregando…" : "Agregar salón"}
      </button>
      {state.error && <span className="text-sm text-red-700 w-full">{state.error}</span>}
    </form>
  );
}
