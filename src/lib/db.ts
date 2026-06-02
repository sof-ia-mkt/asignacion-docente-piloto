// Pool de Postgres (Supabase). Solo se importa desde código de servidor.
import { Pool } from "pg";

const g = globalThis as unknown as { _pgPool?: Pool };

export const pool =
  g._pgPool ??
  new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 5, connectionTimeoutMillis: 15000 });

if (process.env.NODE_ENV !== "production") g._pgPool = pool;

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
