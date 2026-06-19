import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/session";
import { cerrarSesionAccion } from "../login/actions";
import { CambiarPasswordForm } from "./form";

export default async function CambiarPasswordPage() {
  const yo = await sesionActual();
  if (!yo) redirect("/login");

  const forzado = yo.debe_cambiar_password;

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Cambiar mi contraseña</h1>
        <p className="mt-0.5 mb-5 text-sm text-slate-500">
          {forzado
            ? "Por seguridad, fija tu contraseña personal antes de continuar."
            : `${yo.nombre} — elige una contraseña nueva.`}
        </p>
        <CambiarPasswordForm />
        {forzado && (
          <form action={cerrarSesionAccion} className="mt-4">
            <button type="submit" className="text-xs text-slate-400 hover:underline">
              Cerrar sesión
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
