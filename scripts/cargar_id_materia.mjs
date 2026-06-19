// CARGA el ID de la materia (folio numérico de la propuesta, p.ej. 1070) en cada clase
// del ciclo de planeación. NO toca horarios, días ni materias: solo llena slots.id_excel.
//
// Lee los CSV "PROPUESTA SEP - DIC 2026 - <CARRERA>.csv" (uno por pestaña del Excel).
// En cada renglón el ID numérico vive en la columna con encabezado "ID"; la clave de grupo
// (CYC_G11_SM_CB) viene una columna antes. Cruza por (grupo + tipo + materia) contra los
// slots del ciclo y escribe el id_excel.
//
// Por defecto VISTA PREVIA (no escribe). Con --confirmar aplica en una transacción.
//   node scripts/cargar_id_materia.mjs                 -> vista previa (todos los CSV)
//   node scripts/cargar_id_materia.mjs --confirmar     -> aplica
//   node scripts/cargar_id_materia.mjs --dir <carpeta> -> carpeta de los CSV (def. ~/Downloads)
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

// Parser CSV mínimo con soporte de comillas (las celdas de materia pueden traer comas).
function parseCSV(txt) {
  const filas = []; let campo = "", fila = [], enComillas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (enComillas) {
      if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else enComillas = false; }
      else campo += ch;
    } else if (ch === '"') enComillas = true;
    else if (ch === ",") { fila.push(campo); campo = ""; }
    else if (ch === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (ch === "\r") { /* ignora */ }
    else campo += ch;
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// De un renglón saca {clave_grupo, id, tipo, materia}. El ID numérico suele venir en la
// celda inmediatamente después de la clave de grupo (patrón PLAN_Gnn_..._CB/PL/TC/OT),
// pero algunas pestañas (las ingenierías) traen una columna vacía extra y el ID queda
// corrido una celda. Por eso buscamos el primer número en las 1-2 celdas siguientes y
// tomamos tipo/materia justo después de él.
const RE_GRUPO = /^[A-ZÑ]+_G\d+[A-Z0-9_]*_(CB|PL|TC|OT)$/i;
function extraerFila(r) {
  let gi = -1;
  for (let i = 0; i < r.length; i++) if (RE_GRUPO.test((r[i] || "").trim())) { gi = i; break; }
  if (gi < 0) return null;
  let idi = -1;
  for (let k = gi + 1; k <= gi + 2; k++) if (/^\d+$/.test((r[k] || "").trim())) { idi = k; break; }
  if (idi < 0) return null;
  const tipo = (r[idi + 1] || "").trim();
  const materia = (r[idi + 2] || "").trim();
  return { clave_grupo: r[gi].trim(), id: parseInt(r[idi].trim(), 10), tipo, materia };
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
  console.log(`Ciclo destino: ${CICLO.nombre} (${CICLO.codigo})\n`);

  const { rows: cat } = await c.query(`select id, slug from materias`);
  const matBySlug = new Map(cat.map((m) => [m.slug, m.id]));
  const resolverMateriaId = (materia) => {
    let sl = slugify(materia);
    if (aliasMap[sl]) sl = aliasMap[sl];
    return matBySlug.get(sl) ?? null;
  };

  // slots del ciclo, indexados por (clave_grupo|tipo|materia_id) y por (clave_grupo|tipo)
  const { rows: slots } = await c.query(
    `select s.id, g.clave, s.tipo, s.materia_id, s.id_excel
       from slots s join grupos g on g.id = s.grupo_id
      where s.ciclo_id = $1`, [CICLO.id]);
  const porExacto = new Map();     // clave|tipo|matid -> [slotId...]
  const porGrupoTipo = new Map();  // clave|tipo      -> [slotId...]
  for (const s of slots) {
    const kt = `${s.clave}|${norm(s.tipo)}`;
    (porGrupoTipo.get(kt) ?? porGrupoTipo.set(kt, []).get(kt)).push(s);
    const ke = `${kt}|${s.materia_id ?? "x"}`;
    (porExacto.get(ke) ?? porExacto.set(ke, []).get(ke)).push(s);
  }

  const updates = new Map(); // slotId -> id_excel
  let totalFilas = 0, matched = 0, ambiguos = 0, sinSlot = 0, sinMateria = 0, yaIgual = 0, conflicto = 0;
  const detalleSinSlot = [];

  for (const archivo of archivos.sort()) {
    const carrera = archivo.slice(PREFIJO.length).replace(/\.csv$/i, "").trim();
    const filas = parseCSV(readFileSync(join(DIR, archivo), "utf8")).map(extraerFila).filter(Boolean);
    if (!filas.length) { console.log(`· ${carrera}: 0 IDs en el archivo (columna vacía) — se omite`); continue; }
    let m = 0;
    for (const f of filas) {
      totalFilas++;
      const matId = resolverMateriaId(f.materia);
      const kt = `${f.clave_grupo}|${norm(f.tipo)}`;
      let cand = matId != null ? porExacto.get(`${kt}|${matId}`) : null;
      if (!cand || !cand.length) { // fallback: si ese grupo+tipo tiene UN solo slot, es ese
        const gt = porGrupoTipo.get(kt);
        if (gt && gt.length === 1) cand = gt;
      }
      if (!cand || !cand.length) { sinSlot++; if (matId == null) sinMateria++; detalleSinSlot.push(`${carrera}: ${f.id} ${f.clave_grupo} ${f.tipo} ${f.materia}`); continue; }
      if (cand.length > 1) { ambiguos++; continue; }
      const s = cand[0];
      if (s.id_excel === f.id) { yaIgual++; continue; }
      if (updates.has(s.id) && updates.get(s.id) !== f.id) { conflicto++; continue; }
      updates.set(s.id, f.id); m++; matched++;
    }
    console.log(`· ${carrera}: ${filas.length} IDs en archivo → ${m} cruces nuevos`);
  }

  console.log(`\nResumen: ${totalFilas} renglones con ID | ${matched} a escribir | ${yaIgual} ya estaban | ${ambiguos} ambiguos | ${sinSlot} sin clase (${sinMateria} por materia fuera de catálogo) | ${conflicto} conflicto`);
  if (detalleSinSlot.length) {
    console.log(`\nSin clase que cruce (primeros 15):`);
    detalleSinSlot.slice(0, 15).forEach((d) => console.log("   - " + d));
  }

  if (!CONFIRMAR) { console.log(`\nVISTA PREVIA — nada escrito. Corre con --confirmar para aplicar.`); process.exit(0); }
  if (!updates.size) { console.log(`\nNada que escribir.`); process.exit(0); }

  await c.query("begin");
  for (const [slotId, idExcel] of updates) {
    await c.query(`update slots set id_excel = $1 where id = $2`, [idExcel, slotId]);
  }
  await c.query("commit");
  console.log(`\n✔ Escritos ${updates.size} id_excel.`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR:", e.message);
  process.exit(1);
} finally {
  c.release(); await pool.end();
}
