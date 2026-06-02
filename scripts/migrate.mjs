// Corre los .sql de db/migrations en orden contra SUPABASE_DB_URL.
// Uso: node scripts/migrate.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { loadEnv } from "./_env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, "..", "db", "migrations");

const url = loadEnv().SUPABASE_DB_URL;
if (!url) throw new Error("Falta SUPABASE_DB_URL");

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });
await client.connect();

const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  const sql = readFileSync(join(MIG_DIR, f), "utf8");
  process.stdout.write(`-> ${f} ... `);
  await client.query(sql);
  console.log("ok");
}
const { rows } = await client.query(
  "select table_name from information_schema.tables where table_schema='public' order by table_name"
);
console.log("\nTablas en public:", rows.map((r) => r.table_name).join(", "));
await client.end();
