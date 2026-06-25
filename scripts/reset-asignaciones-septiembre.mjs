// Reset de ASIGNACIONES del ciclo en planeación (Septiembre–Diciembre 2026).
// Borra SOLO la tabla `asignaciones` de las clases de ese ciclo. NO toca:
//   - el historial real de mayo (slots.docente_id),
//   - los docentes (profesores), sus CV ni sus candidaturas (materia_candidatos),
//   - materias, grupos, aulas, horarios.
//
// Uso:
//   node scripts/reset-asignaciones-septiembre.mjs           -> SOLO respalda y reporta (no borra)
//   node scripts/reset-asignaciones-septiembre.mjs --apply   -> respalda y LUEGO borra
//
// El respaldo se guarda en backups/asignaciones-septiembre-<timestamp>.json con TODAS
// las filas (incluida la metadata para reinsertarlas tal cual si hay que volver a este punto).
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
  // Ciclo en planeación = el que se está asignando (Septiembre).
  const { rows: [ciclo] } = await db.query(
    `select id, codigo, nombre from ciclos where estado='planeacion' order by es_activo desc, orden desc limit 1`);
  if (!ciclo) { console.error("No hay ciclo en estado 'planeacion'."); process.exit(1); }
  console.log(`Ciclo a resetear: ${ciclo.nombre} (${ciclo.codigo}, id ${ciclo.id})`);

  // Todas las asignaciones de las clases de ESE ciclo (respaldo completo, fila por fila).
  const { rows: asigs } = await db.query(
    `select a.*
       from asignaciones a
       join slots s on s.id = a.slot_id
      where s.ciclo_id = $1
      order by a.slot_id`, [ciclo.id]);

  // Desglose para que quede claro qué se borra.
  const porEstado = {};
  for (const a of asigs) porEstado[a.estado] = (porEstado[a.estado] || 0) + 1;
  const conDocente = asigs.filter((a) => a.profesor_id != null).length;

  // Sanity check: confirmar que NO hay asignaciones de mayo en este lote (no debería haberlas).
  const { rows: [mayo] } = await db.query(
    `select count(*)::int n
       from asignaciones a join slots s on s.id = a.slot_id
       join ciclos c on c.id = s.ciclo_id
      where c.estado = 'historial'`);

  console.log(`\nAsignaciones de septiembre a borrar: ${asigs.length}`);
  console.log(`  por estado:`, porEstado);
  console.log(`  con docente: ${conDocente}  ·  sin docente: ${asigs.length - conDocente}`);
  console.log(`Asignaciones de ciclos HISTORIAL (mayo) que NO se tocan: ${mayo.n}`);

  // Respaldo a disco (siempre, aunque no se aplique el borrado).
  const dir = join(__dirname, "..", "backups");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `asignaciones-septiembre-${ts}.json`);
  writeFileSync(file, JSON.stringify({
    generado_en: new Date().toISOString(),
    ciclo,
    total: asigs.length,
    por_estado: porEstado,
    asignaciones: asigs,
  }, null, 2));
  console.log(`\n✅ Respaldo guardado: ${file}`);

  if (!APPLY) {
    console.log(`\n(Modo respaldo: NO se borró nada. Vuelve a correr con --apply para borrar.)`);
    process.exit(0);
  }

  // Borrado acotado al ciclo de septiembre, en transacción.
  await db.query("begin");
  const del = await db.query(
    `delete from asignaciones a
       using slots s
      where a.slot_id = s.id and s.ciclo_id = $1`, [ciclo.id]);
  await db.query("commit");
  console.log(`\n🗑️  Borradas ${del.rowCount} asignaciones de ${ciclo.nombre}.`);
  console.log(`Las clases de septiembre quedaron en blanco para empezar de cero.`);
} catch (e) {
  try { await db.query("rollback"); } catch {}
  console.error("Error:", e.message);
  process.exit(1);
} finally {
  await db.end();
}
