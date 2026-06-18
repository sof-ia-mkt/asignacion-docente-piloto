// Carga ADITIVA de OTAY / TECATE / PALMAS desde db/seed_data/proyeccion.json.
// NO trunca ni toca CASA BLANCA, ni los CVs, ni el trabajo manual.
// Idempotente: borra solo los slots de los planteles cargados antes de reinsertar.
// Uso: node scripts/cargar_planteles.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { loadEnv } from "./_env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, "..", "db", "seed_data", "proyeccion.json"), "utf8"));

// Planteles a cargar (CB ya está migrado; se deja intacto).
const LOAD = new Set(["OTAY", "TECATE", "PALMAS"]);

const env = loadEnv();
const slugify = (s) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000,
});
await client.connect();

async function batchInsert(table, cols, rows, { conflict = "", returning = "" } = {}) {
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
    const sql = `insert into ${table} (${cols.join(",")}) values ${tuples.join(",")}`
      + (conflict ? ` ${conflict}` : "") + (returning ? ` returning ${returning}` : "");
    const res = await client.query(sql, params);
    out.push(...res.rows);
  }
  return out;
}

// Inserta los slugs que falten y devuelve name(variante)->id para los nombres dados.
async function upsertCatalog(table, names) {
  const bySlug = new Map();        // slug -> nombre canónico
  const nameToSlug = new Map();
  for (const n of names) {
    if (!n) continue;
    const sl = slugify(n);
    nameToSlug.set(n, sl);
    if (!bySlug.has(sl)) bySlug.set(sl, n);
  }
  const rows = [...bySlug.entries()].map(([slug, nombre]) => ({ nombre, slug }));
  await batchInsert(table, ["nombre", "slug"], rows, { conflict: "on conflict (slug) do nothing" });
  const res = await client.query(`select id, slug from ${table}`);
  const slugToId = Object.fromEntries(res.rows.map((r) => [r.slug, r.id]));
  const nameToId = {};
  for (const [n, sl] of nameToSlug) nameToId[n] = slugToId[sl];
  return nameToId;
}

try {
  await client.query("begin");

  const slots = data.slots.filter((s) => LOAD.has(s.plantel));
  const grupos = data.grupos.filter((g) => LOAD.has(g.plantel));
  console.log(`Cargando ${[...LOAD].join(", ")}: ${slots.length} slots, ${grupos.length} grupos`);

  // ---- catálogos (planes, materias) referenciados por estos slots/grupos ----
  const planId = await upsertCatalog("planes",
    [...slots.map((s) => s.plan), ...grupos.map((g) => g.plan)].filter(Boolean));
  const matId = await upsertCatalog("materias", slots.map((s) => s.materia).filter(Boolean));

  // ---- profesores nuevos (docentes de mayo de estos planteles, sin CV) ----
  const docNames = slots.map((s) => s.docente).filter(Boolean);
  const profId = await upsertCatalog("profesores", docNames);

  // ---- aulas (upsert; ya estaban, no estorba) ----
  await batchInsert("aulas", ["clave", "tipo", "capacidad"],
    data.aulas.map((a) => ({ clave: a.clave, tipo: a.tipo, capacidad: a.capacidad })),
    { conflict: "on conflict (clave) do update set tipo=excluded.tipo, capacidad=excluded.capacidad" });

  // ---- grupos (con alumnos) ----
  const grpRows = grupos.map((g) => ({
    clave: g.clave, plan_id: planId[g.plan] ?? null,
    cuatrimestre: g.cuatrimestre || null, turno: g.turno || null,
    alumnos: data.alumnos_por_grupo[g.clave] ?? null,
  }));
  await batchInsert("grupos", ["clave", "plan_id", "cuatrimestre", "turno", "alumnos"], grpRows, {
    conflict: "on conflict (clave) do update set plan_id=excluded.plan_id, cuatrimestre=excluded.cuatrimestre, turno=excluded.turno, alumnos=excluded.alumnos",
  });
  const grpRes = await client.query("select id, clave from grupos");
  const grpId = Object.fromEntries(grpRes.rows.map((r) => [r.clave, r.id]));

  // ---- slots: borra los de estos planteles (idempotente) y reinserta mayo + septiembre ----
  await client.query(
    `delete from slots where plantel = any($1)`, [[...LOAD]]);

  const slotCols = ["id_excel", "plantel", "ciclo", "es_historial", "plan_id", "grupo_id", "materia_id",
    "cuatrimestre", "tipo", "modalidad", "dia", "turno", "hora_inicio", "hora_fin",
    "fecha_inicio", "fecha_fin", "fecha_raw", "confirmacion", "docente_id"];
  const mkSlot = (s, historial) => ({
    id_excel: s.id_excel, plantel: s.plantel,
    ciclo: historial ? data.ciclo_historial : data.ciclo_a_asignar,
    es_historial: historial,
    plan_id: planId[s.plan] ?? null,
    grupo_id: s.grupo ? (grpId[s.grupo] ?? null) : null,
    materia_id: matId[s.materia] ?? null,
    cuatrimestre: s.cuatrimestre || null, tipo: s.tipo || null, modalidad: s.modalidad || null,
    dia: s.dia, turno: s.turno, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin,
    fecha_inicio: s.fecha_inicio, fecha_fin: s.fecha_fin, fecha_raw: s.fecha_raw,
    confirmacion: s.confirmacion,
    docente_id: historial ? (s.docente ? profId[s.docente] ?? null : null) : null,
  });
  await batchInsert("slots", slotCols, slots.map((s) => mkSlot(s, true)));
  await batchInsert("slots", slotCols, slots.map((s) => mkSlot(s, false)));

  // ---- candidatos por historial (docentes de estos planteles, +40) ----
  const seenCand = new Set();
  const candRows = [];
  for (const s of slots) {
    if (!s.docente || !s.materia) continue;
    const pid = profId[s.docente], mid = matId[s.materia];
    if (!pid || !mid) continue;
    const k = `${pid}|${mid}`;
    if (seenCand.has(k)) continue;
    seenCand.add(k);
    candRows.push({ profesor_id: pid, materia_id: mid, fuente: "historial",
      puntaje: 40, razon: "Impartió esta materia en mayo 2026" });
  }
  await batchInsert("materia_candidatos",
    ["profesor_id", "materia_id", "fuente", "puntaje", "razon"], candRows,
    { conflict: "on conflict (profesor_id, materia_id) do nothing" });

  await client.query("commit");

  // ---- verificación ----
  const porPlantel = (await client.query(
    "select plantel, count(*)::int n, count(*) filter (where es_historial) may, count(*) filter (where not es_historial) sep from slots group by plantel order by plantel")).rows;
  console.log("\nslots por plantel (mayo / septiembre):");
  for (const r of porPlantel) console.log(`  ${r.plantel.padEnd(12)} total=${r.n}  mayo=${r.may}  sep=${r.sep}`);
  for (const t of ["planes", "materias", "grupos", "profesores", "slots", "materia_candidatos", "aulas"]) {
    const n = (await client.query(`select count(*)::int n from ${t}`)).rows[0].n;
    console.log(`  ${t}: ${n}`);
  }
} catch (e) {
  await client.query("rollback");
  console.error("ERROR:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
