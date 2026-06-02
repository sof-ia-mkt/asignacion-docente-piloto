// Siembra Supabase desde db/seed_data/casablanca.json + cvs_meta.json
// Uso: node --env-file=.env.local scripts/seed.mjs
// Idempotente: trunca y re-inserta (es piloto).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, "..", "db", "seed_data");
const data = JSON.parse(readFileSync(join(SEED_DIR, "casablanca.json"), "utf8"));
const cvMeta = JSON.parse(readFileSync(join(SEED_DIR, "cvs_meta.json"), "utf8"));

const slugify = (s) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await client.connect();

async function batchInsert(table, cols, rows, returning = null) {
  if (!rows.length) return [];
  const out = [];
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((r, ri) => {
      const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
      params.push(...cols.map((c) => r[c]));
      return `(${ph.join(",")})`;
    });
    const ret = returning ? ` returning ${returning}` : "";
    const res = await client.query(
      `insert into ${table} (${cols.join(",")}) values ${tuples.join(",")}${ret}`, params);
    out.push(...res.rows);
  }
  return out;
}

try {
  await client.query("begin");
  await client.query(
    "truncate alertas, asignaciones, materia_candidatos, cv_competencias, slots, grupos, materias, profesores, planes restart identity cascade");

  // Inserta entradas únicas por slug (fusiona variantes con typos/acentos)
  // y devuelve un mapa nombre->id que cubre TODAS las variantes.
  async function insertCatalog(table, names) {
    const bySlug = new Map();          // slug -> nombre canónico (el primero)
    const nameToSlug = new Map();
    for (const n of names) {
      const sl = slugify(n);
      nameToSlug.set(n, sl);
      if (!bySlug.has(sl)) bySlug.set(sl, n);
    }
    const rows = [...bySlug.entries()].map(([slug, nombre]) => ({ nombre, slug }));
    const res = await batchInsert(table, ["nombre", "slug"], rows, "id, slug");
    const slugToId = Object.fromEntries(res.map((r) => [r.slug, r.id]));
    const nameToId = {};
    for (const [n, sl] of nameToSlug) nameToId[n] = slugToId[sl];
    return nameToId;
  }

  // ---- planes ----
  const planNames = [
    ...data.slots_mayo.map((s) => s.plan).filter(Boolean),
    ...data.grupos.map((g) => g.plan).filter(Boolean),
  ];
  const planId = await insertCatalog("planes", planNames);

  // ---- materias ----
  const matId = await insertCatalog("materias", data.materias_catalogo);

  // ---- grupos ----
  const grpRows = data.grupos.map((g) => ({
    clave: g.clave, plan_id: planId[g.plan] ?? null,
    cuatrimestre: g.cuatrimestre || null, turno: g.turno || null,
  }));
  const grpRes = await batchInsert("grupos", ["clave", "plan_id", "cuatrimestre", "turno"], grpRows, "id, clave");
  const grpId = Object.fromEntries(grpRes.map((r) => [r.clave, r.id]));

  // ---- profesores (todos los de mayo; los 20 piloto enriquecidos con CV) ----
  const cvBySlug = Object.fromEntries(cvMeta.map((m) => [m.slug, m]));
  const docNames = data.slots_mayo.map((s) => s.docente).filter(Boolean);
  const profBySlug = new Map();        // slug -> nombre canónico
  const profNameToSlug = new Map();
  for (const n of docNames) {
    const sl = slugify(n);
    profNameToSlug.set(n, sl);
    if (!profBySlug.has(sl)) profBySlug.set(sl, n);
  }
  const profRows = [...profBySlug.entries()].map(([slug, nombre]) => {
    const cv = cvBySlug[slug];
    return {
      nombre, slug,
      licenciatura: cv?.lic ?? null,
      maestria: cv?.maestria ?? null,
      area_cv: cv?.area_inferida ?? null,
      anios_experiencia: cv?.anios_exp ?? null,
      cv_archivo: cv?.archivo ?? null,
      es_coordinador_virtual: false,
    };
  });
  const profCols = ["nombre", "slug", "licenciatura", "maestria", "area_cv", "anios_experiencia", "cv_archivo", "es_coordinador_virtual"];
  const profRes = await batchInsert("profesores", profCols, profRows, "id, slug");
  const profSlugToId = Object.fromEntries(profRes.map((r) => [r.slug, r.id]));
  const profId = {};                   // nombre (cualquier variante) -> id
  for (const [n, sl] of profNameToSlug) profId[n] = profSlugToId[sl];

  // ---- slots: mayo (historial) + septiembre (clon a asignar) ----
  const slotCols = ["id_excel", "plantel", "ciclo", "es_historial", "plan_id", "grupo_id", "materia_id",
    "cuatrimestre", "tipo", "modalidad", "dia", "turno", "hora_inicio", "hora_fin",
    "fecha_inicio", "fecha_fin", "fecha_raw", "confirmacion", "docente_id"];
  const mkSlot = (s, historial) => ({
    id_excel: s.id_excel, plantel: s.plantel,
    ciclo: historial ? data.ciclo_historial : data.ciclo_a_asignar,
    es_historial: historial,
    plan_id: planId[s.plan] ?? null,
    grupo_id: grpId[s.grupo] ?? null,
    materia_id: matId[s.materia] ?? null,
    cuatrimestre: s.cuatrimestre || null, tipo: s.tipo || null, modalidad: s.modalidad || null,
    dia: s.dia, turno: s.turno, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin,
    fecha_inicio: s.fecha_inicio, fecha_fin: s.fecha_fin, fecha_raw: s.fecha_raw,
    confirmacion: s.confirmacion,
    docente_id: historial ? (s.docente ? profId[s.docente] ?? null : null) : null,
  });
  await batchInsert("slots", slotCols, data.slots_mayo.map((s) => mkSlot(s, true)));
  await batchInsert("slots", slotCols, data.slots_mayo.map((s) => mkSlot(s, false)));

  // ---- candidatos por HISTORIAL (TODOS los docentes de mayo, +40) ----
  // El historial real es la señal más fuerte para septiembre, no solo el de los 20 piloto.
  const seenCand = new Set();
  const candRows = [];
  for (const s of data.slots_mayo) {
    if (!s.docente || !s.materia) continue;
    const pid = profId[s.docente], mid = matId[s.materia];
    if (!pid || !mid) continue;
    const k = `${pid}|${mid}`;
    if (seenCand.has(k)) continue;
    seenCand.add(k);
    candRows.push({
      profesor_id: pid, materia_id: mid, fuente: "historial",
      puntaje: 40, razon: "Impartió esta materia en mayo 2026",
    });
  }
  await batchInsert("materia_candidatos",
    ["profesor_id", "materia_id", "fuente", "puntaje", "razon"], candRows);

  await client.query("commit");

  const counts = {};
  for (const t of ["planes", "materias", "grupos", "profesores", "slots", "materia_candidatos"]) {
    counts[t] = (await client.query(`select count(*)::int n from ${t}`)).rows[0].n;
  }
  const sep = (await client.query("select count(*)::int n from slots where es_historial=false")).rows[0].n;
  const may = (await client.query("select count(*)::int n from slots where es_historial=true")).rows[0].n;
  console.log("Siembra OK:", JSON.stringify(counts));
  console.log(`  slots mayo (historial)=${may}  septiembre (a asignar)=${sep}`);
  console.log(`  profesores piloto con CV=${cvMeta.length}`);
} catch (e) {
  await client.query("rollback");
  console.error("ERROR seed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
