// AGREGA al ciclo de planeación las clases de la propuesta que aún NO existen, sin tocar
// nada de lo ya cargado. Es estrictamente ADITIVO: crea los grupos que falten y mete los
// slots cuyo ID (folio de la propuesta) todavía no está en el ciclo. No borra ni reescribe.
//
// Por qué existe: el extractor original (extraer_demanda.py) descartaba por regex las claves
// de 5 segmentos (secciones A/B y ESCM, p.ej. IND_G22_DM_A_CB, CYC_G9_ESCM_A_CB), y además
// a 12 grupos les faltó su componente VIRTUAL. Esto los completa desde los CSV de la propuesta.
//
// Identidad de cada clase = su ID de la propuesta (único por renglón). Insertamos SOLO los
// renglones cuyo ID no está ya en el ciclo; así nunca duplicamos lo existente.
//
//   node scripts/agregar_grupos_faltantes.mjs              -> vista previa (no escribe)
//   node scripts/agregar_grupos_faltantes.mjs --confirmar  -> aplica en una transacción
//   node scripts/agregar_grupos_faltantes.mjs --dir <carp> -> carpeta de los CSV (def. ~/Downloads)
import { loadEnv } from "./_env.mjs";
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALIAS = join(RAIZ, "db", "seed_data", "alias_materias.json");
const CONFIRMAR = process.argv.includes("--confirmar");
const dirArg = process.argv.indexOf("--dir");
const DIR = dirArg >= 0 ? process.argv[dirArg + 1] : join(homedir(), "Downloads");
const PREFIJO = "PROPUESTA SEP - DIC 2026 - ";

const norm = (s) => (s || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const slugify = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
const NA = new Set(["", "N/A", "NA", "N/A.", "GENERAL", "-"]);
const limpiaNA = (v) => (NA.has(norm(v)) ? null : (v || "").trim());
const TIPOS = new Set(["DISCIPLINAR", "MÓDULO 1", "MÓDULO 2", "MÓDULO 3", "VIRTUAL"]);
const RE_GRUPO = /^[A-ZÑ]+_G\d+[A-Z0-9_]*_(CB|PL|TC|OT)$/i;
const PLANTEL = { CB: "CASA BLANCA", PL: "PALMAS", TC: "TECATE", OT: "OTAY" };

function parseCSV(txt) {
  const F = []; let c = "", f = [], q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { f.push(c); c = ""; }
    else if (ch === "\n") { f.push(c); F.push(f); f = []; c = ""; }
    else if (ch === "\r") { /* skip */ }
    else c += ch;
  }
  if (c.length || f.length) { f.push(c); F.push(f); }
  return F;
}

// Mapea columnas por NOMBRE de encabezado (robusto al corrimiento del ID); la clave y el ID
// se sacan por patrón porque viven en columnas "en blanco" del encabezado.
function filasDeArchivo(txt) {
  const rows = parseCSV(txt);
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === "MATERIA"));
  if (hi < 0) return [];
  const H = rows[hi].map(norm);
  const col = (...nombres) => { for (const n of nombres) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const idx = {
    tipo: col("TIPO"), materia: col("MATERIA"), dia: col("DÍA", "DIA"), turno: col("TURNO"),
    hi: col("HORA INICIO"), hf: col("HORA FIN"), cuatri: col("CUATRIMESTRE"),
  };
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    let gi = -1;
    for (let i = 0; i < r.length; i++) if (RE_GRUPO.test((r[i] || "").trim())) { gi = i; break; }
    if (gi < 0) continue;
    let idi = -1;
    for (let k = gi + 1; k <= gi + 2; k++) if (/^\d+$/.test((r[k] || "").trim())) { idi = k; break; }
    if (idi < 0) continue;
    const clave = r[gi].trim();
    const tipoRaw = norm(idx.tipo >= 0 ? r[idx.tipo] : r[idi + 1]);
    const get = (i) => (i >= 0 && i < r.length ? r[i] : "");
    out.push({
      id: parseInt(r[idi].trim(), 10),
      clave,
      plantel: PLANTEL[clave.slice(-2).toUpperCase()] ?? clave.slice(-2),
      tipo: TIPOS.has(tipoRaw) ? tipoRaw : (tipoRaw || null),
      materia: norm(idx.materia >= 0 ? r[idx.materia] : r[idi + 2]),
      cuatrimestre: (get(idx.cuatri) || "").trim() || null,
      dia: limpiaNA(get(idx.dia)),
      turno: limpiaNA(get(idx.turno)),
      hora_inicio: limpiaNA(get(idx.hi)),
      hora_fin: limpiaNA(get(idx.hf)),
    });
  }
  return out;
}

const aliasMap = JSON.parse(readFileSync(ALIAS, "utf8")).alias ?? {};
const archivos = readdirSync(DIR).filter((f) => f.startsWith(PREFIJO) && f.toLowerCase().endsWith(".csv"));
if (!archivos.length) { console.error(`Sin CSV "${PREFIJO}*.csv" en ${DIR}`); process.exit(1); }

const pool = new pg.Pool({ connectionString: loadEnv().SUPABASE_DB_URL, max: 2 });
const c = await pool.connect();
try {
  const { rows: cic } = await c.query(
    `select id, codigo, nombre from ciclos where estado='planeacion' order by orden desc limit 1`);
  if (!cic.length) throw new Error("No hay ciclo en estado 'planeacion'.");
  const CICLO = cic[0];

  // catálogos e índices del ciclo
  const matBySlug = new Map((await c.query(`select id, slug from materias`)).rows.map((m) => [m.slug, m.id]));
  const grpByClave = new Map((await c.query(`select id, clave from grupos`)).rows.map((g) => [g.clave, g.id]));
  // claves que YA tienen slots en este ciclo (≠ que exista la fila de grupo, heredable del historial)
  const clavesConSlots = new Set((await c.query(
    `select distinct g.clave from slots s join grupos g on g.id=s.grupo_id where s.ciclo_id=$1`,
    [CICLO.id])).rows.map((r) => r.clave));
  // identidad por (clave|id): la propuesta a veces reutiliza un mismo ID en dos grupos distintos
  const idsEnCiclo = new Set((await c.query(
    `select g.clave, s.id_excel from slots s join grupos g on g.id=s.grupo_id
      where s.ciclo_id=$1 and s.id_excel is not null`, [CICLO.id])).rows.map((r) => `${r.clave}|${r.id_excel}`));
  // prefijo de carrera (parte antes de _Gnn) -> plan_id, deducido del propio ciclo
  const planPorPrefijo = new Map();
  for (const r of (await c.query(
    `select split_part(g.clave,'_',1) pref, s.plan_id, count(*) n
       from slots s join grupos g on g.id=s.grupo_id
      where s.ciclo_id=$1 and s.plan_id is not null group by 1,2`, [CICLO.id])).rows) {
    const cur = planPorPrefijo.get(r.pref);
    if (!cur || Number(r.n) > cur.n) planPorPrefijo.set(r.pref, { plan_id: r.plan_id, n: Number(r.n) });
  }
  const resolverMateria = (m) => { let sl = slugify(m); if (aliasMap[sl]) sl = aliasMap[sl]; return matBySlug.get(sl) ?? null; };
  const planDe = (clave) => planPorPrefijo.get(clave.split("_")[0])?.plan_id ?? null;

  // recolectar candidatos: renglones cuyo ID no está en el ciclo
  const candidatos = [];
  const vistos = new Set();
  for (const archivo of archivos.sort()) {
    const filas = filasDeArchivo(readFileSync(join(DIR, archivo), "utf8"));
    for (const f of filas) {
      const k = `${f.clave}|${f.id}`;
      if (idsEnCiclo.has(k) || vistos.has(k)) continue; // ya está en el ciclo o repetido en CSV
      vistos.add(k);
      candidatos.push(f);
    }
  }

  // analizar candidatos
  const grupoFilaNueva = new Map(); // clave -> {cuatri, turno, plan_id}  (no existe ni la fila de grupo)
  const clavesNuevasEnCiclo = new Set(); // claves sin slots en el ciclo (grupo nuevo para la planeación)
  const sinPlan = new Set();
  const materiasNuevas = new Map(); // slug -> nombre normalizado (no están en catálogo; se agregan)
  for (const f of candidatos) {
    if (!clavesConSlots.has(f.clave)) clavesNuevasEnCiclo.add(f.clave);
    if (!grpByClave.has(f.clave) && !grupoFilaNueva.has(f.clave)) {
      const plan_id = planDe(f.clave);
      if (plan_id == null) sinPlan.add(f.clave.split("_")[0]);
      grupoFilaNueva.set(f.clave, { cuatrimestre: f.cuatrimestre, turno: f.turno, plan_id });
    }
    if (f.materia && resolverMateria(f.materia) == null) materiasNuevas.set(slugify(f.materia), norm(f.materia));
  }

  // --- REPORTE ---
  console.log("=".repeat(74));
  console.log(`AGREGAR FALTANTES — ciclo ${CICLO.nombre} (${CICLO.codigo}) — ${CONFIRMAR ? "APLICAR" : "VISTA PREVIA"}`);
  console.log("=".repeat(74));
  console.log(`\n● Slots a INSERTAR: ${candidatos.length}`);
  console.log(`● GRUPOS nuevos en el ciclo (sin slots aún): ${clavesNuevasEnCiclo.size}  ·  filas de grupo a crear: ${grupoFilaNueva.size}`);
  const nuevos = candidatos.filter((f) => clavesNuevasEnCiclo.has(f.clave));
  const completan = candidatos.filter((f) => !clavesNuevasEnCiclo.has(f.clave));
  console.log(`\n--- GRUPOS NUEVOS (${nuevos.length} slots en ${clavesNuevasEnCiclo.size} grupos) ---`);
  for (const f of nuevos) console.log(`     ${f.clave.padEnd(18)} ${String(f.tipo).padEnd(11)} ${f.materia || "(sin materia)"}`);
  console.log(`\n--- COMPLETAN GRUPOS EXISTENTES (${completan.length} slots, casi todos el VIRTUAL que faltaba) ---`);
  for (const f of completan) console.log(`     ${f.clave.padEnd(18)} ${String(f.tipo).padEnd(11)} ${f.materia || "(sin materia)"}`);
  if (sinPlan.size) console.log(`\n  ⚠ Prefijos SIN plan_id deducible: ${[...sinPlan].join(", ")} (se insertarían con plan_id null)`);
  if (materiasNuevas.size) {
    console.log(`\n  ＋ Materias NUEVAS al catálogo (${materiasNuevas.size}); se insertan tal cual y se ligan:`);
    for (const [slug, nombre] of materiasNuevas) console.log(`       ${nombre}   [${slug}]`);
  }

  if (!CONFIRMAR) {
    console.log(`\n🧪 VISTA PREVIA: no se tocó la base. Para aplicar: --confirmar`);
    process.exit(0);
  }

  // --- APLICAR (una transacción) ---
  await c.query("begin");
  // 1) materias nuevas al catálogo (tal cual; si ya existe el slug, se reutiliza)
  for (const [slug, nombre] of materiasNuevas) {
    const { rows } = await c.query(
      `insert into materias (nombre, slug) values ($1,$2)
         on conflict (slug) do update set slug=excluded.slug returning id`,
      [nombre, slug]);
    matBySlug.set(slug, rows[0].id);
  }
  for (const [clave, g] of grupoFilaNueva) {
    const { rows } = await c.query(
      `insert into grupos (clave, plan_id, cuatrimestre, turno) values ($1,$2,$3,$4)
         on conflict (clave) do update set clave=excluded.clave returning id`,
      [clave, g.plan_id, g.cuatrimestre, g.turno]);
    grpByClave.set(clave, rows[0].id);
  }
  const cols = ["id_excel", "plantel", "ciclo", "ciclo_id", "es_historial", "plan_id", "grupo_id",
    "materia_id", "cuatrimestre", "tipo", "modalidad", "dia", "turno", "hora_inicio", "hora_fin"];
  let ins = 0;
  for (const f of candidatos) {
    const fila = [
      f.id, f.plantel, CICLO.codigo, CICLO.id, false, planDe(f.clave),
      grpByClave.get(f.clave) ?? null, resolverMateria(f.materia), f.cuatrimestre, f.tipo,
      f.tipo === "VIRTUAL" ? "ASINCRÓNICA" : "PRESENCIAL",
      f.dia, f.turno, f.hora_inicio, f.hora_fin,
    ];
    await c.query(`insert into slots (${cols.join(",")}) values (${cols.map((_, k) => `$${k + 1}`).join(",")})`, fila);
    ins++;
  }
  await c.query("commit");
  console.log(`\n✅ Listo: ${grupoFilaNueva.size} filas de grupo creadas, ${ins} slots insertados (con su ID).`);
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("❌ Falló (ROLLBACK, base intacta):", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
