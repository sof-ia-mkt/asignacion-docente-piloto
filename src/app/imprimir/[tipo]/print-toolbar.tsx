"use client";
// Barra de impresión: botón para abrir el diálogo (Imprimir / Guardar como PDF) y
// volver. Además abre el diálogo solo al cargar, para que "Imprimir / PDF" sea un clic.
// La barra no se imprime (clase no-print).

import { useEffect, useRef } from "react";

export function PrintToolbar() {
  const yaImprimio = useRef(false);

  useEffect(() => {
    if (yaImprimio.current) return; // evita doble disparo (StrictMode en dev)
    yaImprimio.current = true;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="no-print mb-4 flex items-center gap-2">
      <button
        onClick={() => window.print()}
        className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm"
      >
        Imprimir / Guardar PDF
      </button>
      <button
        onClick={() => window.history.back()}
        className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
      >
        Volver
      </button>
      <span className="text-xs text-slate-400">
        En el diálogo elige “Guardar como PDF” como destino para obtener el PDF.
      </span>
    </div>
  );
}
