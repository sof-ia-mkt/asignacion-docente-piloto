// FASE D — Recomendaciones desde CV (SIN API de Claude; usa el CSV ya extraído).
// - materia_candidatos (fuente='cv'): solo match EXACTO por slug contra catálogo. Aditivo:
//   ON CONFLICT (profesor_id, materia_id) sube el puntaje al máximo, nunca lo baja.
// - cv_competencias: rellena SOLO a quien no tiene (preserva los 23 perfiles ya hechos por API).
//   modelo='csv-local' para distinguirlos.
//   node scripts/cargar_recomendaciones.mjs            -> DRY-RUN
//   node scripts/cargar_recomendaciones.mjs --confirmar -> aplica
import { loadEnv } from "./_env.mjs";
import { buildPlan, slugify } from "./_cv_data.mjs";
import pg from "pg";

const APLICA = process.argv.includes("--confirmar");
const PUNTAJE_CV = 15;            // "afín / mencionada en CV" (API usaba alta25/media15/baja8)
const env = loadEnv();
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await c.connect();

const profs = (await c.query("SELECT id,nombre,slug FROM profesores")).rows;
const mats = (await c.query("SELECT id,nombre,slug FROM materias")).rows;
const tieneCC = new Set((await c.query("SELECT profesor_id FROM cv_competencias")).rows.map(r => r.profesor_id));
const profBySlug = new Map(profs.map(p => [p.slug, p]));
const matBySlug = new Map(mats.map(m => [m.slug, m]));
const { plan } = buildPlan({ profBySlug, matBySlug });

const carga = plan.filter(p => (p.accion === "UPDATE" || p.accion === "INSERT") && p.cv?.pdfExiste);

let nCand = 0, nCC = 0, nCCskip = 0, sinId = 0;
try {
  await c.query("begin");
  for (const p of carga) {
    // Usa el id YA resuelto por buildPlan (incluye dup forzado p.ej. JANAI UCIEL);
    // para INSERT (p.id null) cae a slug, que ya existe si Fase C corrió antes.
    const pid = p.id ?? (profBySlug.get(slugify(p.perfil.nombre)) || profBySlug.get(slugify(p.carpeta)))?.id;
    if (!pid) { sinId++; continue; }

    // candidatos exactos
    for (const ex of p.materias.exactas) {
      const r = await c.query(
        `INSERT INTO materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
         VALUES ($1,$2,'cv',$3,$4)
         ON CONFLICT (profesor_id, materia_id)
         DO UPDATE SET puntaje = GREATEST(materia_candidatos.puntaje, EXCLUDED.puntaje)`,
        [pid, ex.materia_id, PUNTAJE_CV, "Mencionada en su CV"]);
      nCand += r.rowCount;
    }

    // cv_competencias: solo si no tiene (preserva los API)
    if (tieneCC.has(pid)) { nCCskip++; continue; }
    const payload = {
      area_principal: (p.perfil.area_cv || "").split(/[\/;]/)[0].trim(),
      licenciatura: p.perfil.licenciatura || "",
      maestria: p.perfil.maestria || null,
      anios_experiencia: p.perfil.anios_experiencia ?? 0,
      materias_que_puede_impartir: p.materias.exactas.map(ex => ({
        materia: ex.materia, confianza: "media", motivo: "Mencionada en su CV",
      })),
    };
    await c.query(
      `INSERT INTO cv_competencias (profesor_id, payload, modelo) VALUES ($1,$2,'csv-local')
       ON CONFLICT (profesor_id) DO NOTHING`,
      [pid, payload]);
    tieneCC.add(pid); nCC++;
  }

  console.log(`materia_candidatos cv tocados: ${nCand}`);
  console.log(`cv_competencias nuevos (csv-local): ${nCC}; preservados (API): ${nCCskip}; sin id: ${sinId}`);
  if (APLICA) { await c.query("commit"); console.log("\n✅ COMMIT. Recomendaciones cargadas."); }
  else { await c.query("rollback"); console.log("\n🟡 DRY-RUN (rollback). Usa --confirmar para aplicar."); }
} catch (e) {
  await c.query("rollback");
  console.error("❌ Error, rollback:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
