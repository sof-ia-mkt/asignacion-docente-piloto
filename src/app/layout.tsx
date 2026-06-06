import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

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
  { href: "/alertas", label: "Alertas" },
  { href: "/historial", label: "Historial" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="bg-slate-900 text-white">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              Asignación Docente
              <span className="ml-2 text-xs font-normal text-slate-400">Coordinación Académica</span>
            </Link>
            <nav className="flex gap-1 text-sm">
              {nav.map((n) => (
                <Link key={n.href} href={n.href}
                  className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-200">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
        <footer className="border-t border-slate-200 text-xs text-slate-500">
          <div className="mx-auto max-w-6xl px-4 py-3">
            Piloto — septiembre se asigna a partir del historial de mayo + CV. Sugerencias automáticas, decisión final de coordinación.
          </div>
        </footer>
      </body>
    </html>
  );
}
