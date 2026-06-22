import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";
import { getCiclos, cicloActivo } from "@/lib/ciclo";
import { CicloSelector } from "./ciclo-selector";
import { sesionActual } from "@/lib/session";
import { tieneAccesoTotal } from "@/lib/usuarios-db";
import { cerrarSesionAccion } from "./login/actions";

export const metadata: Metadata = {
  title: "Asignación Docente — CENYCA",
  description: "Recomendación y asignación de docentes por cuatrimestre — Coordinación Académica",
};

// Todas las páginas leen datos en vivo de la base y están detrás del candado:
// no tiene sentido prerenderizarlas en el build (y hacerlo agota las conexiones
// de Supabase al correr varios workers en paralelo). Render dinámico en cada request.
// Se hereda a todas las rutas hijas.
export const dynamic = "force-dynamic";

const nav = [
  { href: "/", label: "Inicio" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/profesores", label: "Profesores" },
  { href: "/aulas", label: "Aulas" },
  { href: "/asignacion", label: "Asignación" },
  { href: "/compactacion", label: "Compactación" },
  { href: "/alertas", label: "Alertas" },
  { href: "/historial", label: "Historial" },
];

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const usuario = await sesionActual();

  // Sin sesión (p. ej. la página /login): layout mínimo, sin nav ni datos de la app.
  if (!usuario) {
    return (
      <html lang="es" className="h-full antialiased">
        <body className="min-h-full bg-slate-50">{children}</body>
      </html>
    );
  }

  // Cambio de contraseña obligatorio: mientras la bandera esté prendida, toda ruta lleva
  // a /cambiar-password (salvo esa misma). El pathname llega en un header puesto por proxy.ts.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (usuario.debe_cambiar_password && pathname !== "/cambiar-password") {
    redirect("/cambiar-password");
  }

  const [ciclos, activo] = await Promise.all([getCiclos(), cicloActivo()]);
  const accesoTotal = tieneAccesoTotal(usuario);
  const navItems = accesoTotal ? [...nav, { href: "/usuarios", label: "Usuarios" }] : nav;
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="bg-slate-900 text-white">
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="font-semibold tracking-tight shrink-0">
              Asignación Docente
              <span className="ml-2 text-xs font-normal text-slate-400">Coordinación Académica</span>
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {navItems.map((n) => (
                <Link key={n.href} href={n.href}
                  className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-200">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              <CicloSelector
                ciclos={ciclos.map((c) => ({ codigo: c.codigo, nombre: c.nombre, estado: c.estado }))}
                activo={activo.codigo}
              />
              <Link href="/cambiar-password"
                className="text-xs text-slate-300 hover:text-white whitespace-nowrap"
                title="Cambiar mi contraseña">
                {usuario.nombre}{accesoTotal ? " · admin" : ""}
              </Link>
              <form action={cerrarSesionAccion}>
                <button type="submit" className="text-xs text-slate-300 hover:text-white underline whitespace-nowrap">
                  Cerrar sesión
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
        <footer className="border-t border-slate-200 text-xs text-slate-500">
          <div className="mx-auto max-w-6xl px-4 py-3">
            El cuatrimestre a asignar se arma desde el historial de ciclos anteriores + CV. Sugerencias automáticas, decisión final de coordinación.
          </div>
        </footer>
      </body>
    </html>
  );
}
