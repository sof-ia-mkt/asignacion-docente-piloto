"use client";

// Frontera de error de toda la app (App Router). Si una página de servidor lanza
// (p. ej. una caída momentánea de la base que ya agotó los reintentos), en vez de
// una pantalla en blanco mostramos un mensaje claro y un botón para reintentar.
import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Queda en los logs de Vercel para diagnóstico (el usuario solo ve el mensaje amable).
    console.error("Error de página:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-sm font-medium text-slate-400">Algo salió mal</p>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">
        No se pudo cargar esta pantalla
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        Suele ser un tropiezo momentáneo de la conexión con la base. Vuelve a intentarlo;
        si sigue fallando, recarga la página o regresa al inicio.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2">
        <button
          onClick={() => reset()}
          className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-800">
          Reintentar
        </button>
        <Link href="/" className="px-4 py-2 rounded-md border border-slate-200 text-sm text-slate-700 hover:border-slate-300">
          Ir al inicio
        </Link>
      </div>
      {error.digest && (
        <p className="mt-6 text-xs text-slate-400">Referencia: {error.digest}</p>
      )}
    </div>
  );
}
