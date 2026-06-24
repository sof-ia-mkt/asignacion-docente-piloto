// Limpieza de la tabla `planes`: fusiona duplicados (misma carrera con typos)
// y corrige acentos en los nombres. Causa raíz: cargar_demanda.mjs deduplica por
// slug, y los typos del Excel generaban slugs distintos -> filas duplicadas.
//
// Fusiones (dup -> canónico): reasigna slots.plan_id y grupos.plan_id, luego borra el dup.
// Confirmado por el código de grupo (split_part(clave,'_',1)): ELEC/IND/MEC/SIS coinciden.
//
//   node scripts/limpiar_planes.mjs            -> DRY-RUN (rollback)
//   node scripts/limpiar_planes.mjs --confirmar -> aplica (commit)
import { loadEnv } from "./_env.mjs";
import pg from "pg";

const APLICA = process.argv.includes("--confirmar");
const env = loadEnv();
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await c.connect();

// dup -> canónico (verificado por conteo de grupos y código de clave)
const FUSIONES = [
  { dup: 19, canon: 1, carrera: "Electromecánica" },
  { dup: 23, canon: 2, carrera: "Industrial" },
  { dup: 21, canon: 3, carrera: "Mecatrónica" },
  { dup: 20, canon: 4, carrera: "Sistemas Computacionales" },
];

// id -> nombre canónico (acentos corregidos). Solo los que cambian.
const RENOMBRES = [
  { id: 2, nombre: "LICENCIATURA EN INGENIERÍA INDUSTRIAL" },
  { id: 4, nombre: "LICENCIATURA EN INGENIERÍA EN SISTEMAS COMPUTACIONALES" },
  { id: 7, nombre: "LICENCIATURA EN GASTRONOMÍA" },
  { id: 9, nombre: "LICENCIATURA EN CRIMINOLOGÍA Y CRIMINALÍSTICA" },
];

let mvSlots = 0, mvGrupos = 0, delPlanes = 0, renamed = 0;
try {
  await c.query("begin");

  for (const f of FUSIONES) {
    const s = await c.query("UPDATE slots SET plan_id=$1 WHERE plan_id=$2", [f.canon, f.dup]);
    const g = await c.query("UPDATE grupos SET plan_id=$1 WHERE plan_id=$2", [f.canon, f.dup]);
    const d = await c.query("DELETE FROM planes WHERE id=$1", [f.dup]);
    mvSlots += s.rowCount; mvGrupos += g.rowCount; delPlanes += d.rowCount;
    console.log(`  fusión ${f.dup}->${f.canon} (${f.carrera}): slots=${s.rowCount} grupos=${g.rowCount} plan_borrado=${d.rowCount}`);
  }

  for (const r of RENOMBRES) {
    const u = await c.query("UPDATE planes SET nombre=$1 WHERE id=$2", [r.nombre, r.id]);
    renamed += u.rowCount;
    console.log(`  rename id=${r.id} -> ${r.nombre}  (${u.rowCount})`);
  }

  console.log(`\nResumen: slots movidos=${mvSlots} · grupos movidos=${mvGrupos} · planes borrados=${delPlanes} · renombrados=${renamed}`);

  // Verificación: ningún slot/grupo huérfano apuntando a un plan inexistente.
  const huerfanos = await c.query(`
    select 'slots' t, count(*)::int n from slots s left join planes p on p.id=s.plan_id where s.plan_id is not null and p.id is null
    union all
    select 'grupos', count(*)::int from grupos g left join planes p on p.id=g.plan_id where g.plan_id is not null and p.id is null`);
  const malos = huerfanos.rows.filter(r => r.n > 0);
  if (malos.length) throw new Error("Huérfanos tras fusión: " + JSON.stringify(huerfanos.rows));
  console.log("Integridad OK: 0 slots/grupos huérfanos.");

  const final = await c.query("select id,nombre from planes order by nombre");
  console.log(`\nCatálogo final (${final.rows.length} planes):`);
  final.rows.forEach(x => console.log(`  id=${String(x.id).padStart(2)}  ${x.nombre}`));

  if (APLICA) { await c.query("commit"); console.log("\n✅ COMMIT. Planes limpios."); }
  else { await c.query("rollback"); console.log("\n🟡 DRY-RUN (rollback). Usa --confirmar para aplicar."); }
} catch (e) {
  await c.query("rollback");
  console.error("❌ Error, rollback:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
