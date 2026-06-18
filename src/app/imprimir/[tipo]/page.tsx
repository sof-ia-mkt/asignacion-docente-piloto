// Vista de impresión / PDF para cualquier pantalla de datos.
// /imprimir/<tipo>?<filtros>  ->  página limpia (sin filtros ni botones) lista para
// imprimir o "Guardar como PDF" desde el navegador. Reutiliza getReport (misma fuente
// que la exportación a Excel), así que muestra exactamente las mismas tablas.

import { notFound } from "next/navigation";
import { getReport } from "@/lib/reports";
import { PrintToolbar } from "./print-toolbar";

export default async function ImprimirPage({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tipo } = await params;
  const sp = await searchParams;
  // Reconstruye los filtros como URLSearchParams para reusar getReport tal cual.
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") usp.set(k, v);
    else if (Array.isArray(v) && v[0]) usp.set(k, v[0]);
  }

  const report = await getReport(tipo, usp);
  if (!report) notFound();

  const fecha = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="print-root">
      <PrintToolbar />

      <header className="mb-5">
        <div className="text-xs text-slate-400">CENYCA · Asignación Docente</div>
        <h1 className="text-2xl font-semibold text-slate-900">{report.title}</h1>
        {report.subtitle && <p className="text-sm text-slate-500">{report.subtitle}</p>}
        <p className="text-xs text-slate-400 mt-1">Generado el {fecha}</p>
      </header>

      {report.tables.map((t, ti) => (
        <section key={ti} className="mb-6 break-inside-avoid">
          {report.tables.length > 1 && (
            <h2 className="text-sm font-semibold text-slate-700 mb-2">{t.name}</h2>
          )}
          {t.rows.length === 0 ? (
            <p className="text-sm text-slate-400">Sin datos.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left">
                  {t.headers.map((h, i) => (
                    <th key={i} className="border border-slate-300 bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-slate-200 px-2 py-1 text-slate-700 align-top">
                        {cell === null || cell === undefined || cell === "" ? "" : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      <footer className="mt-6 text-xs text-slate-400 break-inside-avoid">
        CENYCA — septiembre se asigna a partir del historial de mayo + CV.
      </footer>
    </div>
  );
}
