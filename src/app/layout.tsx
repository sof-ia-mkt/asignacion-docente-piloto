import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Geist } from "next/font/google";
import "./globals.css";

// globals.css referencia --font-geist-sans desde el scaffold original, pero la variable nunca
// se definió: la app corría con la fuente del sistema por accidente. next/font la sirve
// self-hosted (sin peticiones externas) y con métricas de fallback anti-layout-shift.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
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

  // Sin sesión válida: solo /login puede renderizar (con el layout mínimo). Cualquier otra
  // ruta redirige. Esto cubre el hueco del middleware, que solo valida la FIRMA del token:
  // si el usuario fue desactivado, su cookie sigue firmada pero sesionActual() ya da null,
  // y sin este redirect la página renderizaría datos igual (baja sin corte real de acceso).
  if (!usuario) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname !== "/login" && !pathname.startsWith("/login/")) {
      redirect("/login");
    }
    return (
      <html lang="es" className={`h-full antialiased ${geist.variable}`}>
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
    <html lang="es" className={`h-full antialiased ${geist.variable}`}>
      <body className="min-h-full flex flex-col">
        <header className="bg-slate-900 text-white">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
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
        {activo.estado !== "planeacion" && (
          <div className="bg-amber-50 border-b border-amber-200">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-2 text-sm text-amber-900">
              <span className="font-medium">Estás viendo {activo.nombre} (historial): solo lectura.</span>{" "}
              Este ciclo ya cerró y alimenta la recomendación; no se puede modificar. Para hacer cambios,
              elige el cuatrimestre en curso en el selector de ciclo.
            </div>
          </div>
        )}
        <main className="flex-1 mx-auto w-full max-w-[1440px] px-4 sm:px-6 py-6">{children}</main>
        <footer className="border-t border-slate-200 text-xs text-slate-500">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-3">
            El cuatrimestre a asignar se arma desde el historial de ciclos anteriores + CV. Sugerencias automáticas, decisión final de coordinación.
          </div>
        </footer>
      </body>
    </html>
  );
}
