"use client";
// Form "agregar materia que puede dar" con useActionState: los rechazos del servidor
// (materia que no existe en el catálogo) y las confirmaciones se muestran inline.
// Antes la acción hacía un return mudo: el usuario pulsaba "Agregar" y no pasaba nada.
import { useActionState } from "react";
import { agregarCandidatura } from "@/app/actions";
import { BotonSubmit } from "@/lib/boton-submit";

export function FormCandidatura({
  profesorId,
  disponibles,
}: {
  profesorId: number;
  disponibles: { id: number; nombre: string }[];
}) {
  const [state, dispatch] = useActionState(agregarCandidatura.bind(null, profesorId), {});
  return (
    <form action={dispatch} className="mt-4 flex flex-wrap items-end gap-2">
      <div className="grow min-w-64">
        <label htmlFor="materia-nueva" className="block text-sm font-medium text-slate-700 mb-1">
          Agregar una materia que puede dar
        </label>
        <input id="materia-nueva" name="materia" list="materias-disponibles" required
          className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm"
          placeholder="Escribe el nombre de la materia del catálogo…" />
        <datalist id="materias-disponibles">
          {disponibles.map((m) => <option key={m.id} value={m.nombre} />)}
        </datalist>
      </div>
      <BotonSubmit className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm whitespace-nowrap" pendingText="Agregando…">
        Agregar
      </BotonSubmit>
      {state.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="w-full text-xs text-green-700">{state.ok}</p>}
    </form>
  );
}
