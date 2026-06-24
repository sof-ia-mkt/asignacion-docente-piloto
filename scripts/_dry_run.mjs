// DRY-RUN (solo lectura). Imprime el manifiesto exacto de carga. No escribe nada.
import { loadEnv } from "./_env.mjs";
import { buildPlan } from "./_cv_data.mjs";
import pg from "pg";

const env = loadEnv();
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await c.connect();
const profs = (await c.query("SELECT id,nombre,slug FROM profesores")).rows;
const mats = (await c.query("SELECT id,nombre,slug FROM materias")).rows;
await c.end();

const profBySlug = new Map(profs.map(p => [p.slug, p]));
const matBySlug = new Map(mats.map(m => [m.slug, m]));

const { plan } = buildPlan({ profBySlug, matBySlug });

const by = {};
for (const p of plan) by[p.accion] = (by[p.accion] || 0) + 1;

console.log("=== MANIFIESTO DE CARGA (dry-run) ===");
console.log("Filas hoja_revision:", plan.length);
console.log("Acciones:", JSON.stringify(by, null, 0), "\n");

const upd = plan.filter(p => p.accion === "UPDATE");
const ins = plan.filter(p => p.accion === "INSERT");
const omit = plan.filter(p => p.accion.startsWith("OMITIR"));
const err = plan.filter(p => p.accion.startsWith("ERROR"));

console.log(`-- UPDATE (perfil sobre id existente): ${upd.length}`);
console.log(`-- INSERT (profesor nuevo real): ${ins.length}`);
ins.forEach(p => console.log(`   + ${p.carpeta}`));
console.log(`-- OMITIR: ${omit.length}`);
omit.forEach(p => console.log(`   · ${p.carpeta} [${p.accion}]`));
if (err.length) {
  console.log(`\n‼️ ERRORES (${err.length}):`);
  err.forEach(p => console.log(`   ! ${p.carpeta} [${p.accion}] estado=${p.estado}`));
}

// PDFs
const conCV = plan.filter(p => p.cv && (p.accion === "UPDATE" || p.accion === "INSERT"));
const faltanPDF = conCV.filter(p => !p.cv.pdfExiste);
console.log(`\n-- PDFs a subir (UPDATE/INSERT con CV): ${conCV.length}`);
console.log(`   en disco OK: ${conCV.length - faltanPDF.length}; FALTAN: ${faltanPDF.length}`);
faltanPDF.forEach(p => console.log(`   ✗ ${p.carpeta} -> ${p.cv.archivo}`));

// Materias
let totExact = 0, totCrudas = 0, conPayload = 0;
for (const p of conCV) {
  totExact += p.materias.exactas.length;
  totCrudas += p.materias.crudas.length;
  if (p.materias.crudas.length) conPayload++;
}
console.log(`\n-- Recomendaciones:`);
console.log(`   materia_candidatos (match exacto catálogo): ${totExact}`);
console.log(`   cv_competencias.payload (perfiles con materias crudas): ${conPayload} (${totCrudas} menciones totales)`);

// Correos
const conCorreo = conCV.filter(p => p.perfil.correo).length;
console.log(`\n-- Perfiles con correo: ${conCorreo}/${conCV.length} (telefono: NO se carga)`);
console.log("\nDRY-RUN OK. Nada se escribió.");
