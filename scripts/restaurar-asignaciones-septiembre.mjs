// Restaura las asignaciones de septiembre desde el respaldo JSON más reciente
// (o el archivo que se pase como argumento). Reinserta las filas tal cual y
// recalcula las alertas para dejar el estado idéntico a antes del borrado.
//
// Uso:
//   node scripts/restaurar-asignaciones-septiembre.mjs                 -> usa el backup más reciente
//   node scripts/restaurar-asignaciones-septiembre.mjs <archivo.json>  -> usa ese backup
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv } from "./_env.mjs";
import { recomputarAlertas } from "../src/lib/alertas-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const backupsDir = join(__dirname, "..", "backups");

// Elegir archivo: argumento o el más reciente que empiece por "asignaciones-septiembre-".
let file = process.argv[2];
if (!file) {
  const cands = readdirSync(backupsDir)
    .filter((f) => f.startsWith("asignaciones-septiembre-") && f.endsWith(".json"))
    .sort();
  if (!cands.length) { console.error("No hay respaldos en backups/."); process.exit(1); }
  file = join(backupsDir, cands[cands.length - 1]);
}
console.log(`Restaurando desde: ${file}`);

const data = JSON.parse(readFileSync(file, "utf8"));
const filas = data.asignaciones || [];
if (!filas.length) { console.error("El respaldo no tiene asignaciones."); process.exit(1); }
console.log(`Filas a restaurar: ${filas.length}  ·  ciclo: ${data.ciclo?.nombre}`);

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();
const query = (sql, params = []) => db.query(sql, params).then((r) => r.rows);

try {
  await db.query("begin");

  // Seguridad: no duplicar. Solo restauramos si las clases de ese ciclo están SIN asignación.
  const cicloId = data.ciclo.id;
  const { rows: [{ n: yaHay }] } = await db.query(
    `select count(*)::int n from asignaciones a join slots s on s.id = a.slot_id where s.ciclo_id = $1`,
    [cicloId]);
  if (yaHay > 0) {
    console.error(`Ya existen ${yaHay} asignaciones de ese ciclo. Aborto para no duplicar.`);
    await db.query("rollback");
    process.exit(1);
  }

  // Inserta cada fila con TODAS sus columnas originales (preserva id, estado, puntaje, etc.).
  const cols = Object.keys(filas[0]);
  const colList = cols.map((c) => `"${c}"`).join(", ");
  let n = 0;
  for (const fila of filas) {
    const vals = cols.map((c) => fila[c]);
    const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
    await db.query(`insert into asignaciones (${colList}) values (${ph})`, vals);
    n++;
  }

  // Si la tabla tiene secuencia en id, reajustarla por si se insertaron ids explícitos.
  await db.query(
    `select setval(pg_get_serial_sequence('asignaciones','id'),
                   coalesce((select max(id) from asignaciones), 1))`).catch(() => {});

  // Recalcular alertas para dejar el panel idéntico a antes.
  await recomputarAlertas(query, cicloId);

  await db.query("commit");
  console.log(`\n✅ Restauradas ${n} asignaciones. Alertas recalculadas. Estado regresado al respaldo.`);
} catch (e) {
  try { await db.query("rollback"); } catch {}
  console.error("Error:", e.message);
  process.exit(1);
} finally {
  await db.end();
}
