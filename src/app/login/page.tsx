import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/session";
import { LoginForm } from "./form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expirada?: string }>;
}) {
  // Si ya hay sesión, no tiene sentido el login.
  if (await sesionActual()) redirect("/");
  // `expirada=1` lo pone exigirSesionActiva cuando alguien intenta guardar algo con la sesión
  // vencida: sin este aviso, volver al login de golpe parece una falla de la plataforma.
  const { expirada } = await searchParams;
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Asignación Docente</h1>
        <p className="mt-0.5 mb-5 text-sm text-slate-500">Coordinación Académica — CENYCA</p>
        {expirada && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Tu sesión expiró y el último cambio no se guardó. Vuelve a entrar e inténtalo otra vez.
          </p>
        )}
        <LoginForm />
      </div>
    </div>
  );
}
