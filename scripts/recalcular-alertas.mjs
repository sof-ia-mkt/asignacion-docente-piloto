// Recalcula las alertas del ciclo en planeación desde el ESTADO ACTUAL.
// Diagnóstico puro: NO asigna docentes ni toca datos; solo rehace la tabla `alertas`.
// Útil tras un reset de asignaciones para que el panel no muestre alertas viejas.
import pg from "pg";
import { loadEnv } from "./_env.mjs";
import { recomputarAlertas } from "../src/lib/alertas-core.mjs";

const env = loadEnv();
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();
const query = (sql, params = []) => db.query(sql, params).then((r) => r.rows);

try {
  const { rows: [ciclo] } = await db.query(
    `select id, nombre from ciclos where estado='planeacion' order by es_activo desc, orden desc limit 1`);
  if (!ciclo) { console.error("No hay ciclo en planeación."); process.exit(1); }
  await db.query("begin");
  const res = await recomputarAlertas(query, ciclo.id);
  await db.query("commit");
  console.log(`Alertas recalculadas para ${ciclo.nombre}: ${res.total}`);
  console.log("Por tipo:", res.porTipo);
} catch (e) {
  try { await db.query("rollback"); } catch {}
  console.error("Error:", e.message);
  process.exit(1);
} finally {
  await db.end();
}
