// Auditoría de solo-lectura del sistema. NO modifica nada (solo SELECT).
// Uso: node scripts/auditoria.mjs
// Foco: materias mal escritas / repetidas (casi-duplicados), + salud general.
import pg from "pg";
import { loadEnv } from "./_env.mjs";

const db = new pg.Client({ connectionString: loadEnv().SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();

// --- normalización para comparar: MAYÚSCULAS, sin acentos, sin puntuación, espacios colapsados ---
const norm = (s) => (s ?? "")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")   // quita acentos
  .toUpperCase()
  .replace(/[^A-Z0-9\s]/g, " ")                        // puntuación -> espacio
  .replace(/\s+/g, " ").trim();

// quita una "s" final de cada palabra (para detectar singular/plural)
const sinPlural = (s) => norm(s).split(" ").map((w) => w.replace(/(.{3,})S$/, "$1")).join(" ");

// distancia de Levenshtein (para typos: ELETRONICA vs ELECTRONICA)
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
  }
  return d[m][n];
}
// similitud de tokens (Jaccard): cuántas palabras comparten (orden distinto, palabra de más)
const jaccard = (a, b) => {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter);
};

// ---- traer materias con su uso real ----
const mats = (await db.query(`
  select m.id, m.nombre,
    (select count(*) from slots s where s.materia_id=m.id and s.es_historial)::int n_hist,
    (select count(*) from slots s where s.materia_id=m.id and not s.es_historial)::int n_sept,
    (select count(*) from materia_candidatos c where c.materia_id=m.id)::int n_cand
  from materias m order by m.nombre`)).rows;

console.log(`\n================  AUDITORÍA DE MATERIAS  ================`);
console.log(`Total de materias en catálogo: ${mats.length}`);

// 1) Mismo nombre tras normalizar (acentos/espacios/puntuación) = casi seguro la misma materia
const porNorm = new Map();
for (const m of mats) {
  const k = norm(m.nombre);
  if (!porNorm.has(k)) porNorm.set(k, []);
  porNorm.get(k).push(m);
}
const dupNorm = [...porNorm.values()].filter((g) => g.length > 1);
console.log(`\n--- A) MISMA materia escrita distinto (acentos/espacios/puntuación): ${dupNorm.length} grupos ---`);
for (const g of dupNorm) {
  console.log(`  • ${g.map((m) => `"${m.nombre}" [id ${m.id}, ${m.n_hist}h/${m.n_sept}s/${m.n_cand}c]`).join("  ==  ")}`);
}

// 2) Singular/plural
const porPlural = new Map();
for (const m of mats) {
  const k = sinPlural(m.nombre);
  if (!porPlural.has(k)) porPlural.set(k, []);
  porPlural.get(k).push(m);
}
const dupPlural = [...porPlural.values()].filter((g) => g.length > 1 && new Set(g.map((m) => norm(m.nombre))).size > 1);
console.log(`\n--- B) Posible singular/plural de la misma materia: ${dupPlural.length} grupos ---`);
for (const g of dupPlural) console.log(`  • ${g.map((m) => `"${m.nombre}" [id ${m.id}]`).join("  ==  ")}`);

// 3) Typos / muy parecidas (Levenshtein bajo o Jaccard alto), sin repetir lo ya reportado en A
const yaReportado = new Set();
for (const g of dupNorm) for (const m of g) yaReportado.add(m.id);
const pares = [];
for (let i = 0; i < mats.length; i++) for (let j = i + 1; j < mats.length; j++) {
  const a = mats[i], b = mats[j];
  const na = norm(a.nombre), nb = norm(b.nombre);
  if (na === nb) continue;
  const dist = lev(na, nb);
  const jac = jaccard(a.nombre, b.nombre);
  const maxLen = Math.max(na.length, nb.length);
  // typo: muy poca diferencia de letras en nombres no triviales
  const esTypo = dist > 0 && dist <= 2 && maxLen >= 6;
  // mismas palabras casi todas, o una contiene a la otra como subconjunto de tokens
  const esCasi = jac >= 0.8;
  if (esTypo || esCasi) pares.push({ a, b, dist, jac });
}
pares.sort((p, q) => q.jac - p.jac || p.dist - q.dist);
console.log(`\n--- C) Nombres muy parecidos (typos o casi iguales): ${pares.length} pares ---`);
for (const p of pares) {
  console.log(`  • "${p.a.nombre}" [id ${p.a.id}, ${p.a.n_hist}h/${p.a.n_sept}s]  ~~  "${p.b.nombre}" [id ${p.b.id}, ${p.b.n_hist}h/${p.b.n_sept}s]   (dif ${p.dist} letras, ${(p.jac*100).toFixed(0)}% palabras)`);
}

// 4) Materias huérfanas: no las usa ningún slot (ni mayo ni septiembre)
const huerfanas = mats.filter((m) => m.n_hist === 0 && m.n_sept === 0);
console.log(`\n--- D) Materias sin NINGÚN slot (huérfanas en catálogo): ${huerfanas.length} ---`);
for (const m of huerfanas) console.log(`  • "${m.nombre}" [id ${m.id}, candidatos ${m.n_cand}]`);

// 5) Solo en historial (mayo) o solo en septiembre — útil para entender la migración
const soloHist = mats.filter((m) => m.n_hist > 0 && m.n_sept === 0);
const soloSept = mats.filter((m) => m.n_sept > 0 && m.n_hist === 0);
console.log(`\n--- E) Cobertura: ${mats.filter(m=>m.n_hist&&m.n_sept).length} en mayo Y septiembre · ${soloHist.length} solo mayo · ${soloSept.length} solo septiembre ---`);
if (soloSept.length) {
  console.log(`   (solo septiembre = se van a dar pero NADIE las dio en mayo → suelen quedar sin candidato)`);
  for (const m of soloSept.slice(0, 30)) console.log(`     - "${m.nombre}" [${m.n_sept} slots]`);
  if (soloSept.length > 30) console.log(`     … y ${soloSept.length - 30} más`);
}

// 6) Nombres "sucios": dígitos sueltos, romanos colgando, dobles espacios originales, saltos de línea
const sucias = mats.filter((m) => /\n|\t|  |^\s|\s$/.test(m.nombre) || /[^\wÁÉÍÓÚÜÑáéíóúüñ .,/()0-9I-]/.test(m.nombre));
console.log(`\n--- F) Nombres con caracteres raros / espacios sospechosos: ${sucias.length} ---`);
for (const m of sucias.slice(0, 40)) console.log(`  • [id ${m.id}] ${JSON.stringify(m.nombre)}`);

// ================  SALUD GENERAL DEL SISTEMA  ================
console.log(`\n\n================  SALUD GENERAL DEL SISTEMA  ================`);
const one = async (label, sql) => { const r = (await db.query(sql)).rows[0]; console.log(`  ${label}: ${Object.values(r).join(" / ")}`); };

await one("Slots totales (mayo / septiembre)", `select count(*) filter (where es_historial) hist, count(*) filter (where not es_historial) sept from slots`);
await one("Slots septiembre SIN materia_id", `select count(*) n from slots where not es_historial and materia_id is null`);
await one("Slots septiembre SIN grupo_id", `select count(*) n from slots where not es_historial and grupo_id is null`);
await one("Slots septiembre SIN horario (día null)", `select count(*) n from slots where not es_historial and dia is null`);
await one("Slots historial SIN docente_id", `select count(*) n from slots where es_historial and docente_id is null`);
await one("Planteles (septiembre)", `select string_agg(distinct plantel, ', ') p from slots where not es_historial`);
await one("Profesores totales", `select count(*) n from profesores`);
await one("Profesores 'placeholder' (no personas)", `select count(*) n from profesores where nombre = any(array['CAMBIO DE TURNO','DOCENTE NUEVO','NO SE APERTURA','NOSE APERTURA'])`);
await one("Grupos totales / sin plan", `select count(*) tot, count(*) filter (where plan_id is null) sinplan from grupos`);
await one("Asignaciones (con docente / vacías)", `select count(*) filter (where profesor_id is not null) con, count(*) filter (where profesor_id is null) sin from asignaciones`);
await one("Slots septiembre sin fila en asignaciones", `select count(*) n from slots s where not s.es_historial and not exists (select 1 from asignaciones a where a.slot_id=s.id)`);
await one("Aulas en catálogo", `select count(*) n from aulas`);
await one("Alertas vigentes", `select count(*) n from alertas`);

// Profesores con nombre sospechoso (placeholders no listados, números, etc.)
const profsRaros = (await db.query(`select id, nombre from profesores where nombre ~ '[0-9]' or nombre ~* 'cambio|apertura|nuevo|pendiente|sin |por definir|n/a' order by nombre`)).rows;
console.log(`\n  Profesores con nombre sospechoso (revisar si son personas reales): ${profsRaros.length}`);
for (const p of profsRaros) console.log(`     - [id ${p.id}] "${p.nombre}"`);

await db.end();
console.log(`\n================  FIN AUDITORÍA  ================\n`);
