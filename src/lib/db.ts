// Pool de Postgres (Supabase). Solo se importa desde código de servidor.
import { Pool } from "pg";

const g = globalThis as unknown as { _pgPool?: Pool };

export const pool =
  g._pgPool ??
  new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    max: 5,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    keepAlive: true,
  });

// Cachea el pool entre recargas de módulo en TODOS los entornos (incl. producción serverless):
// evita crear pools huérfanos que agoten las conexiones del pooler de Supabase.
g._pgPool = pool;

// Errores TRANSITORIOS de conexión (no de SQL): vale la pena reintentar.
// El pooler de Supabase a veces rechaza/corta conexiones bajo presión; en la página más
// pesada (Dashboards → Resumen, ~9 queries casi en paralelo) eso se veía como "server error".
const CODIGOS_TRANSITORIOS = new Set([
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "08006", // connection_failure
  "08001", // unable_to_connect
  "08004", // rejected connection
  "08003", // connection_does_not_exist
]);
function esTransitorio(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code && CODIGOS_TRANSITORIOS.has(err.code)) return true;
  const m = (err.message ?? "").toLowerCase();
  return (
    m.includes("timeout") ||
    m.includes("connection terminated") ||
    m.includes("econnreset") ||
    m.includes("too many") ||
    m.includes("connect")
  );
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  let ultimoError: unknown;
  for (let intento = 0; intento < 3; intento++) {
    try {
      const res = await pool.query(text, params);
      return res.rows as T[];
    } catch (e) {
      ultimoError = e;
      if (!esTransitorio(e)) throw e; // error real de SQL: reintentar no ayuda
      await new Promise((r) => setTimeout(r, 200 * (intento + 1))); // backoff corto: 200ms, 400ms
    }
  }
  throw ultimoError;
}
