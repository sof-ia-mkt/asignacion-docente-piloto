// Vacía TODAS las asignaciones de docente de septiembre (manuales + automáticas sugeridas):
// borra las filas de `asignaciones` que tienen profesor_id, dejando las clases sin docente.
// NO toca: historial de mayo, docentes, CV, candidaturas, materias, grupos, aulas, horarios.
//
// Siempre respalda TODAS las asignaciones de septiembre antes de borrar (reversible con
// scripts/restaurar-asignaciones-septiembre.mjs apuntando al backup generado).
//
// Uso:
//   node scripts/vaciar-docentes-septiembre.mjs           -> SOLO respalda y reporta
//   node scripts/vaciar-docentes-septiembre.mjs --apply   -> respalda y LUEGO borra + recalcula alertas
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv } from "./_env.mjs";
import { recomputarAlertas } from "../src/lib/alertas-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const env = loadEnv();
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();
const query = (sql, p = []) => db.query(sql, p).then((r) => r.rows);

try {
  const { rows: [ciclo] } = await db.query(
    `select id, codigo, nombre from ciclos where estado='planeacion' order by es_activo desc, orden desc limit 1`);
  if (!ciclo) { console.error("No hay ciclo en planeación."); process.exit(1); }
  console.log(`Ciclo: ${ciclo.nombre} (${ciclo.codigo}, id ${ciclo.id})`);

  // Respaldo completo de septiembre (todas las filas, no solo las que se borran).
  const asigs = await query(
    `select a.* from asignaciones a join slots s on s.id=a.slot_id where s.ciclo_id=$1 order by a.slot_id`, [ciclo.id]);
  const conDocente = asigs.filter((a) => a.profesor_id != null).length;
  console.log(`\nAsignaciones de septiembre: ${asigs.length} (con docente: ${conDocente}, sin docente: ${asigs.length - conDocente})`);
  console.log(`Se borrarán las ${conDocente} que tienen docente; quedan ${asigs.length - conDocente} sin docente.`);

  const dir = join(__dirname, "..", "backups");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `asignaciones-septiembre-${ts}.json`);
  writeFileSync(file, JSON.stringify({ generado_en: new Date().toISOString(), ciclo, total: asigs.length, asignaciones: asigs }, null, 2));
  console.log(`\n✅ Respaldo guardado: ${file}`);

  if (!APPLY) { console.log(`\n(Modo respaldo: NO se borró nada. Corre con --apply para vaciar.)`); process.exit(0); }

  await db.query("begin");
  const del = await db.query(
    `delete from asignaciones a using slots s
      where a.slot_id=s.id and s.ciclo_id=$1 and a.profesor_id is not null`, [ciclo.id]);
  await recomputarAlertas(query, ciclo.id);
  await db.query("commit");
  console.log(`\n🗑️  Quitado el docente de ${del.rowCount} clases. Alertas recalculadas.`);
  console.log(`Septiembre quedó sin ningún docente asignado (lienzo en blanco).`);
} catch (e) {
  try { await db.query("rollback"); } catch {}
  console.error("Error:", e.message);
  process.exit(1);
} finally {
  await db.end();
}
