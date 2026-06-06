"use client";
// Botón "Deshacer" de una fila del historial (Fase 2 de la bitácora).
// Pide confirmación, llama a la acción de servidor y muestra el resultado en línea:
//  - éxito → mensaje verde (la página ya se revalidó y la fila de "Deshizo" aparece arriba).
//  - conflicto/bloqueo → mensaje ámbar (alguien ya cambió ese dato; no se pisa su trabajo).
import { useActionState } from "react";
import { deshacerCambio, type DeshacerState } from "@/app/actions";

export function BotonDeshacer({ id, descripcion }: { id: number; descripcion: string }) {
  const [state, action, pending] = useActionState<DeshacerState, FormData>(deshacerCambio, {});

  // Ya se deshizo con éxito: no tiene sentido volver a ofrecer el botón en esta fila.
  if (state.ok) return <span className="text-xs text-green-700">Deshecho ✓</span>;

  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm(`¿Deshacer este movimiento?\n\n${descripcion}\n\nSe revertirá al estado anterior. Si el dato ya cambió desde entonces, se bloqueará para no pisar un cambio más reciente.`))
            e.preventDefault();
        }}
        className="px-2 py-1 rounded-md border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
      >
        {pending ? "Deshaciendo…" : "↩︎ Deshacer"}
      </button>
      {state.error && <span className="text-xs text-amber-700 max-w-[14rem]">{state.error}</span>}
    </form>
  );
}
