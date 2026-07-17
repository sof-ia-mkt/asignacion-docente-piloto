"use client";
// Frontera de error del ROOT LAYOUT. error.tsx NO envuelve al layout de su propio segmento:
// si el layout truena (p. ej. la base cae mientras resuelve sesión/ciclos), sin este archivo
// el usuario vería la pantalla de error cruda de Next. Debe definir <html> y <body> propios
// porque reemplaza al layout completo.
import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Error del layout raíz:", error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <div style={{ maxWidth: 480, margin: "6rem auto", textAlign: "center", padding: "0 1rem" }}>
          <p style={{ fontSize: 14, color: "#94a3b8", fontWeight: 500 }}>Algo salió mal</p>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#0f172a", marginTop: 8 }}>
            No se pudo cargar la aplicación
          </h1>
          <p style={{ fontSize: 14, color: "#475569", marginTop: 12 }}>
            Suele ser un tropiezo momentáneo de la conexión con la base. Vuelve a intentarlo;
            si sigue fallando, espera un momento y recarga la página.
          </p>
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: 24, padding: "8px 16px", borderRadius: 6, border: 0,
              background: "#0f172a", color: "#fff", fontSize: 14, cursor: "pointer",
            }}>
            Reintentar
          </button>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 24 }}>Referencia: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
