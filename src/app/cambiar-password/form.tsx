"use client";
import { useActionState } from "react";
import { cambiarPasswordAccion, type CambioState } from "./actions";

export function CambiarPasswordForm() {
  const [state, action, pending] = useActionState<CambioState, FormData>(cambiarPasswordAccion, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="actual" className="block text-sm font-medium text-slate-700">Contraseña actual</label>
        <input
          id="actual" name="actual" type="password" autoComplete="current-password" autoFocus
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="nueva" className="block text-sm font-medium text-slate-700">Nueva contraseña</label>
        <input
          id="nueva" name="nueva" type="password" autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">Mínimo 8 caracteres, con letras y números.</p>
      </div>
      <div>
        <label htmlFor="confirmar" className="block text-sm font-medium text-slate-700">Repite la nueva contraseña</label>
        <input
          id="confirmar" name="confirmar" type="password" autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit" disabled={pending}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Guardando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
