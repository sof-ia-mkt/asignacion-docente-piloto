// RESPALDO de la base (datos). El esquema ya está versionado en db/migrations/ (GitHub),
// así que aquí respaldamos SOLO los datos, en un snapshot CONSISTENTE (una sola transacción
// REPEATABLE READ READ ONLY: todas las tablas se leen de la misma foto, aunque alguien escriba
// mientras corre). Salida: backups/respaldo_<fecha>.json.gz  (comprimido; contiene PII → gitignored).
//
//   node scripts/respaldo_db.mjs            -> crea un respaldo nuevo con fecha/hora
//
// Restaurar: node scripts/restaurar_db.mjs <archivo.json.gz>  (ver ese script).
import { loadEnv } from "./_env.mjs";
import pg from "pg";
import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const env = loadEnv();
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(RAIZ, "backups");
mkdirSync(DIR, { recursive: true });

// El pooler en modo transacción (6543) sirve: una transacción se fija a un backend
// durante toda su duración, así que el snapshot es coherente.
const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });
const c = await pool.connect();

const ahora = new Date();
const sello = ahora.toISOString().slice(0, 19).replace(/[:T]/g, "-"); // 2026-06-03-16-40-00
const archivo = join(DIR, `respaldo_${sello}.json.gz`);

try {
  // Descubre tablas y su tipo de columnas (para restaurar bien jsonb, fechas, etc.).
  const { rows: tablas } = await c.query(`
    select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by table_name`);

  await c.query("begin transaction isolation level repeatable read read only");

  const dump = { meta: { creado_en: ahora.toISOString(), db: env.SUPABASE_DB_URL.replace(/:[^:@/]+@/, ":***@"), tablas: {} }, datos: {} };
  for (const { table_name: t } of tablas) {
    const { rows } = await c.query(`select * from ${t}`);
    dump.datos[t] = rows;
    dump.meta.tablas[t] = rows.length;
  }
  await c.query("commit");

  const json = JSON.stringify(dump);
  writeFileSync(archivo, gzipSync(json, { level: 9 }));
  const kb = (statSync(archivo).size / 1024).toFixed(1);

  console.log(`✅ Respaldo creado: ${archivo}  (${kb} KB comprimido)`);
  console.log("   Filas por tabla:");
  for (const [t, n] of Object.entries(dump.meta.tablas)) console.log(`     ${t.padEnd(20)} ${n}`);
  console.log("\n   Restaurar con:  node scripts/restaurar_db.mjs " + archivo + " --confirmar");
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("❌ Falló el respaldo:", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
