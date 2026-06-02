// Estima cuánto costó la ingesta de CVs (no llama a la API; solo cuenta lo guardado).
// Uso: node scripts/costo.mjs
import pg from "pg";
import { loadEnv } from "./_env.mjs";

const env = loadEnv();
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();

// claude-sonnet-4-6 (USD por millón de tokens)
const PRECIO = { in: 3, out: 15, cacheRead: 0.30, cacheWrite: 3.75 };
// Costo aproximado por CV leído (medido en las corridas reales):
//   ~3,000 tok entrada fresca + ~2,500 tok salida + ~2,685 tok cache-read
const porCV =
  (3000 * PRECIO.in + 2500 * PRECIO.out + 2685 * PRECIO.cacheRead) / 1_000_000;

const n = (await db.query("select count(*)::int n from cv_competencias")).rows[0].n;
console.log(`CVs procesados (guardados en BD): ${n} / 20`);
console.log(`Costo aprox. de la ingesta:      ~$${(n * porCV).toFixed(2)} USD`);
console.log(`(≈ $${porCV.toFixed(3)} por CV. Re-correr sin --force cuesta $0.)`);
await db.end();
