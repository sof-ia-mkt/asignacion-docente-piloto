"use client";
import { useActionState } from "react";
import { iniciarSesion, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(iniciarSesion, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="usuario" className="block text-sm font-medium text-slate-700">Usuario</label>
        <input
          id="usuario" name="usuario" type="text" autoComplete="username" autoFocus
          placeholder="nombre.apellido"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">Contraseña</label>
        <input
          id="password" name="password" type="password" autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit" disabled={pending}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
