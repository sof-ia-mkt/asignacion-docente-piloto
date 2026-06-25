// Limpia del Historial (bitácora) SOLO los movimientos de tipo "Asignación"
// (entidad='asignacion': asignó / quitó / confirmó / deshizo de docente a materia).
// NO toca el resto del Historial ni ningún dato de negocio (asignaciones, docentes, etc.).
// Es solo el registro de auditoría de esas acciones de prueba.
//
// Siempre respalda lo que va a borrar antes de hacerlo (reversible reinsertando el JSON).
//
// Uso:
//   node scripts/limpiar-bitacora-asignaciones.mjs           -> SOLO respalda y reporta
//   node scripts/limpiar-bitacora-asignaciones.mjs --apply   -> respalda y LUEGO borra
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv } from "./_env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const env = loadEnv();
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();

try {
  const { rows: filas } = await db.query(
    `select * from bitacora where entidad='asignacion' order by creado_en`);
  const porAccion = {};
  for (const f of filas) porAccion[f.accion] = (porAccion[f.accion] || 0) + 1;
  console.log(`Movimientos de Historial tipo "Asignación" a borrar: ${filas.length}`);
  console.log(`  por acción:`, porAccion);

  const { rows: [{ n: total }] } = await db.query("select count(*)::int n from bitacora");
  console.log(`Historial total actual: ${total}  ·  quedarían: ${total - filas.length}`);

  const dir = join(__dirname, "..", "backups");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `bitacora-asignaciones-${ts}.json`);
  writeFileSync(file, JSON.stringify({ generado_en: new Date().toISOString(), total: filas.length, por_accion: porAccion, movimientos: filas }, null, 2));
  console.log(`\n✅ Respaldo guardado: ${file}`);

  if (!APPLY) { console.log(`\n(Modo respaldo: NO se borró nada. Corre con --apply para limpiar.)`); process.exit(0); }

  const del = await db.query("delete from bitacora where entidad='asignacion'");
  console.log(`\n🗑️  Borrados ${del.rowCount} movimientos de Historial tipo "Asignación".`);
  console.log(`El resto del Historial queda intacto.`);
} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
} finally {
  await db.end();
}
