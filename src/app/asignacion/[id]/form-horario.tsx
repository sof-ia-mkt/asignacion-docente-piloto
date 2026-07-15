"use client";
// Formulario de día/horario de la clase. Cliente (useActionState) para poder mostrar el
// error de validación EN LÍNEA (p. ej. horario invertido) sin tumbar la página, y para
// deshabilitar el botón mientras guarda (evita el doble submit → bitácora duplicada).
import { useActionState } from "react";
import { editarHorario, type EditarHorarioState } from "@/app/actions";

export function FormHorario({
  slotId,
  dia,
  horaInicio,
  horaFin,
  dias,
}: {
  slotId: number;
  dia: string | null;
  horaInicio: string | null;
  horaFin: string | null;
  dias: string[];
}) {
  const [state, action, pending] = useActionState<EditarHorarioState, FormData>(
    editarHorario.bind(null, slotId), {});

  return (
    <>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Día</label>
          <select name="dia" defaultValue={dia ?? ""} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm">
            <option value="">— sin día —</option>
            {dias.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Hora inicio</label>
          <input name="hora_inicio" defaultValue={horaInicio ?? ""} placeholder="07:00"
            className="px-3 py-1.5 rounded-md border border-slate-300 text-sm w-24" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Hora fin</label>
          <input name="hora_fin" defaultValue={horaFin ?? ""} placeholder="09:00"
            className="px-3 py-1.5 rounded-md border border-slate-300 text-sm w-24" />
        </div>
        <button disabled={pending} className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar horario"}
        </button>
      </form>
      {state.error && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{state.error}</p>
      )}
      {state.ok && <p className="mt-2 text-xs text-green-700">{state.ok}</p>}
    </>
  );
}
