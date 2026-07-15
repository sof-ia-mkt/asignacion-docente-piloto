"use client";
// Botón "Resetear contraseña" de la tabla de usuarios. La temporal ahora es aleatoria
// por usuario, así que el resultado se muestra UNA vez aquí mismo (con botón copiar);
// después ya no hay forma de recuperarla — solo volver a resetear.
import { useActionState, useState } from "react";
import { resetearPasswordAccion, type ResetPasswordState } from "./actions";

export function BotonResetPassword({ id, nombre }: { id: number; nombre: string }) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(
    resetearPasswordAccion.bind(null, id), {});
  const [copiado, setCopiado] = useState(false);

  if (state.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-slate-500">Temporal:</span>
        <code className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900 font-mono">{state.ok}</code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(state.ok!).then(() => setCopiado(true))}
          className="text-blue-700 hover:underline"
        >
          {copiado ? "Copiada ✓" : "Copiar"}
        </button>
      </span>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`¿Resetear la contraseña de ${nombre}?\n\nSe generará una temporal nueva que verás UNA sola vez. Su contraseña actual dejará de servir y tendrá que fijar una nueva al entrar.`))
          e.preventDefault();
      }}
      className="inline"
    >
      <button disabled={pending} className="text-blue-700 hover:underline text-xs disabled:opacity-50">
        {pending ? "Reseteando…" : "Resetear contraseña"}
      </button>
      {state.error && <span className="ml-1.5 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
