import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/session";
import { LoginForm } from "./form";

export default async function LoginPage() {
  // Si ya hay sesión, no tiene sentido el login.
  if (await sesionActual()) redirect("/");
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Asignación Docente</h1>
        <p className="mt-0.5 mb-5 text-sm text-slate-500">Coordinación Académica — CENYCA</p>
        <LoginForm />
      </div>
    </div>
  );
}
