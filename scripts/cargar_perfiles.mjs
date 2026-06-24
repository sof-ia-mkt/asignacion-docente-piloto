// FASE C — Carga de PERFILES desde CV (UPDATE existentes + INSERT nuevos).
// Solo campos académicos: licenciatura, maestria, doctorado, area_cv, anios_experiencia, correo.
// NO toca telefono (no existe la columna y no se desea). NO borra nada.
// Seguro: corre en UNA transacción; sin --confirmar es DRY-RUN.
//   node scripts/cargar_perfiles.mjs            -> DRY-RUN (no escribe)
//   node scripts/cargar_perfiles.mjs --confirmar -> aplica
import { loadEnv } from "./_env.mjs";
import { buildPlan, slugify } from "./_cv_data.mjs";
import pg from "pg";

const APLICA = process.argv.includes("--confirmar");
const env = loadEnv();
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await c.connect();

const profs = (await c.query("SELECT id,nombre,slug FROM profesores")).rows;
const mats = (await c.query("SELECT id,nombre,slug FROM materias")).rows;
const profBySlug = new Map(profs.map(p => [p.slug, p]));
const matBySlug = new Map(mats.map(m => [m.slug, m]));
const { plan } = buildPlan({ profBySlug, matBySlug });

const updates = plan.filter(p => p.accion === "UPDATE");
const inserts = plan.filter(p => p.accion === "INSERT");

// Solo escribe valores no vacíos: nunca pisa un dato existente con NULL/"".
const COALESCE_COLS = ["licenciatura", "maestria", "doctorado", "area_cv", "correo"];

let upd = 0, ins = 0;
try {
  await c.query("begin");
  for (const p of updates) {
    const v = p.perfil;
    const r = await c.query(
      `UPDATE profesores SET
         licenciatura = COALESCE(NULLIF($2,''), licenciatura),
         maestria     = COALESCE(NULLIF($3,''), maestria),
         doctorado    = COALESCE(NULLIF($4,''), doctorado),
         area_cv      = COALESCE(NULLIF($5,''), area_cv),
         correo       = COALESCE(NULLIF($6,''), correo),
         anios_experiencia = COALESCE($7, anios_experiencia)
       WHERE id = $1`,
      [p.id, v.licenciatura || "", v.maestria || "", v.doctorado || "",
       v.area_cv || "", v.correo || "", v.anios_experiencia]
    );
    upd += r.rowCount;
  }
  for (const p of inserts) {
    const v = p.perfil;
    const slug = slugify(v.nombre);
    // Defensa extra: si por carrera de slug ya existe, lo tratamos como UPDATE.
    const r = await c.query(
      `INSERT INTO profesores (nombre, slug, licenciatura, maestria, doctorado, area_cv, anios_experiencia, correo, es_coordinador_virtual, propuesta_estado)
       VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7,NULLIF($8,''),false,'pendiente')
       ON CONFLICT (slug) DO UPDATE SET
         licenciatura = COALESCE(EXCLUDED.licenciatura, profesores.licenciatura),
         maestria     = COALESCE(EXCLUDED.maestria, profesores.maestria),
         doctorado    = COALESCE(EXCLUDED.doctorado, profesores.doctorado),
         area_cv      = COALESCE(EXCLUDED.area_cv, profesores.area_cv),
         correo       = COALESCE(EXCLUDED.correo, profesores.correo),
         anios_experiencia = COALESCE(EXCLUDED.anios_experiencia, profesores.anios_experiencia)
       RETURNING (xmax = 0) AS inserted`,
      [v.nombre, slug, v.licenciatura || "", v.maestria || "", v.doctorado || "",
       v.area_cv || "", v.anios_experiencia, v.correo || ""]
    );
    ins += r.rows[0].inserted ? 1 : 0;
  }

  console.log(`UPDATE aplicados: ${upd}/${updates.length}`);
  console.log(`INSERT nuevos:    ${ins}/${inserts.length}`);
  if (APLICA) { await c.query("commit"); console.log("\n✅ COMMIT. Perfiles cargados."); }
  else { await c.query("rollback"); console.log("\n🟡 DRY-RUN (rollback). Usa --confirmar para aplicar."); }
} catch (e) {
  await c.query("rollback");
  console.error("❌ Error, rollback:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
