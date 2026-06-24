// FASE B — Sube los PDF de CV a Storage (bucket privado "cvs") y guarda cv_path.
// Requiere que los perfiles ya existan (corre Fase C antes). Idempotente (upsert).
//   node scripts/subir_cvs.mjs            -> DRY-RUN (lista, no sube)
//   node scripts/subir_cvs.mjs --confirmar -> crea bucket, sube y fija cv_path
import { loadEnv } from "./_env.mjs";
import { buildPlan, slugify } from "./_cv_data.mjs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { readFileSync } from "node:fs";

const APLICA = process.argv.includes("--confirmar");
const env = loadEnv();
const BUCKET = "cvs";

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await c.connect();

const profs = (await c.query("SELECT id,nombre,slug FROM profesores")).rows;
const mats = (await c.query("SELECT id,nombre,slug FROM materias")).rows;
const profBySlug = new Map(profs.map(p => [p.slug, p]));
const profById = new Map(profs.map(p => [p.id, p]));
const matBySlug = new Map(mats.map(m => [m.slug, m]));
const { plan } = buildPlan({ profBySlug, matBySlug });

const subir = plan.filter(p => (p.accion === "UPDATE" || p.accion === "INSERT") && p.cv?.pdfExiste);
console.log(`CVs a subir: ${subir.length}`);

if (!APLICA) {
  for (const p of subir.slice(0, 5)) console.log(`  ej: ${p.carpeta} -> ${slugify(p.perfil.nombre)}.pdf`);
  console.log("🟡 DRY-RUN. Usa --confirmar para crear el bucket y subir.");
  await c.end();
  process.exit(0);
}

// Crear bucket privado si no existe
const { data: buckets } = await sb.storage.listBuckets();
if (!buckets?.some(b => b.name === BUCKET)) {
  const { error } = await sb.storage.createBucket(BUCKET, { public: false });
  if (error) { console.error("❌ createBucket:", error.message); process.exit(1); }
  console.log(`bucket privado "${BUCKET}" creado`);
} else {
  console.log(`bucket "${BUCKET}" ya existe`);
}

let ok = 0, errs = 0;
for (const p of subir) {
  // id resuelto por buildPlan (incluye dup forzado); INSERT cae a slug (ya existe tras Fase C)
  const prof = (p.id != null ? profById.get(p.id) : null)
    || profBySlug.get(slugify(p.perfil.nombre)) || profBySlug.get(slugify(p.carpeta));
  if (!prof) { console.warn(`  ⚠️ sin profesor para ${p.carpeta}, salto`); errs++; continue; }
  const path = `${prof.slug}.pdf`;
  const buf = readFileSync(p.cv.pdfPath);
  const up = await sb.storage.from(BUCKET).upload(path, buf, {
    contentType: "application/pdf", upsert: true,
  });
  if (up.error) { console.error(`  ❌ ${p.carpeta}: ${up.error.message}`); errs++; continue; }
  await c.query("UPDATE profesores SET cv_path=$1, cv_archivo=COALESCE(cv_archivo,$2) WHERE id=$3",
    [path, p.cv.archivo, prof.id]);
  ok++;
}
console.log(`\n✅ Subidos/actualizados: ${ok}; errores: ${errs}`);
await c.end();
