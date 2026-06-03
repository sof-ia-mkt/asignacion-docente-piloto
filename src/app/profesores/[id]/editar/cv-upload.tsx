"use client";
import { useActionState } from "react";
import { procesarCVDocente, type ProcesarCVState } from "@/app/actions";

// Sube el PDF del CV de un docente existente; Claude lo lee (~$0.05) y suma materias candidatas
// + actualiza sus datos. Bind del profesorId para encajar con la firma (prev, formData) de useActionState.
export function CVUpload({ profesorId }: { profesorId: number }) {
  const action = procesarCVDocente.bind(null, profesorId);
  const [state, formAction, pending] = useActionState<ProcesarCVState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file" name="cv" accept="application/pdf" required disabled={pending}
          className="block text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-slate-900 file:text-white disabled:opacity-50" />
        <button
          disabled={pending}
          className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm whitespace-nowrap disabled:opacity-50">
          {pending ? "Leyendo CV…" : "Leer CV con IA"}
        </button>
        {pending && <span className="text-xs text-slate-500">Puede tardar unos segundos.</span>}
      </div>
      {state.error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">{state.ok}</p>
      )}
    </form>
  );
}
