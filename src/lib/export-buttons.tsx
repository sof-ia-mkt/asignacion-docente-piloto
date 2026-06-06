// Botones reutilizables de exportación para cualquier pantalla de datos.
// - "Excel": descarga un .xlsx (route handler /export/<tipo>).
// - "Imprimir / PDF": abre la vista limpia /imprimir/<tipo> en otra pestaña, que
//   dispara el diálogo de impresión (ahí se elige "Guardar como PDF").
// Ambos conservan los filtros activos de la pantalla (se pasan en `params`).
// Lleva la clase `no-print` para no aparecer cuando se imprime la propia pantalla.

import Link from "next/link";

export function ExportButtons({
  tipo,
  params = {},
  className = "",
}: {
  tipo: string;
  params?: Record<string, string | number | undefined | null>;
  className?: string;
}) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const qs = usp.toString();
  const suffix = qs ? `?${qs}` : "";
  const btn =
    "px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 whitespace-nowrap";

  return (
    <div className={`no-print flex items-center gap-1.5 ${className}`}>
      <a href={`/export/${tipo}${suffix}`} className={btn}>
        Exportar a Excel
      </a>
      <Link href={`/imprimir/${tipo}${suffix}`} target="_blank" className={btn}>
        Imprimir / PDF
      </Link>
    </div>
  );
}
