// PARCHE NO DESTRUCTIVO de horarios de septiembre (ciclo de planeación).
//
// Problema: la plataforma se cargó desde un export HTML que perdió Hora Inicio/Fin.
// Los CSV por carrera SÍ los traen. Este script RELLENA esos horarios en los slots
// que YA existen, sin borrar nada y sin tocar ninguna asignación.
//
//   node scripts/parchar_horarios.mjs              -> VISTA PREVIA (no escribe)
//   node scripts/parchar_horarios.mjs --confirmar  -> aplica (una transacción)
//
// Empareja cada fila del CSV con su slot por (clave_grupo + tipo + materia). Solo
// escribe hora_inicio/hora_fin/dia/turno donde el slot los tiene VACÍOS. Si el slot
// ya tiene un horario DISTINTO, NO lo pisa: lo reporta como conflicto para que lo veas.
//
// Lee: db/seed_data/demanda_sepdic2026_csv.json  (extraer_demanda_csv.py)
//      db/seed_data/alias_materias.json
import { loadEnv } from "./_env.mjs";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEMANDA = join(RAIZ, "db", "seed_data", "demanda_sepdic2026_csv.json");
const ALIAS = join(RAIZ, "db", "seed_data", "alias_materias.json");
const CONFIRMAR = process.argv.includes("--confirmar");

const slugify = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

// Normaliza una hora a "HH:MM" con cero a la izquierda. '8:00' y '08:00' son la misma
// hora: sin esto se reportaban como "conflicto" falso. Devuelve "" si no es hora.
const normHora = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
};

const dem = JSON.parse(readFileSync(DEMANDA, "utf8"));
const aliasMap = JSON.parse(readFileSync(ALIAS, "utf8")).alias ?? {};
const slots = dem.slots;

const pool = new pg.Pool({ connectionString: loadEnv().SUPABASE_DB_URL, max: 2 });
const c = await pool.connect();
try {
  const { rows: cic } = await c.query(
    `select id, codigo, nombre from ciclos where estado='planeacion' order by es_activo desc, orden desc limit 1`);
  if (!cic.length) throw new Error("No hay ciclo en estado 'planeacion'.");
  const CICLO = cic[0];

  const { rows: cat } = await c.query(`select id, slug from materias`);
  const matBySlug = new Map(cat.map((m) => [m.slug, m.id]));
  const resolverMateriaId = (s) => {
    let sl = slugify(s.materia_canonica || s.materia);
    if (aliasMap[sl]) sl = aliasMap[sl];
    return matBySlug.get(sl) ?? null;
  };

  // slots existentes de septiembre, indexados por clave|tipo|materia_id
  const { rows: dbslots } = await c.query(
    `select s.id, g.clave, s.tipo, s.materia_id, s.plantel,
            s.hora_inicio, s.hora_fin, s.dia, s.turno
       from slots s join grupos g on g.id = s.grupo_id
      where s.ciclo_id = $1`, [CICLO.id]);
  const idx = new Map();
  for (const r of dbslots) idx.set(`${r.clave}|${r.tipo}|${r.materia_id}`, r);

  const vacio = (v) => v == null || String(v).trim() === "";

  const aLlenar = [];      // {slot, hora_inicio, hora_fin, dia, turno}
  const conflictos = [];   // slot ya tiene horario distinto
  const yaOk = [];         // ya coincide
  const sinMatch = [];     // no se encontró slot
  const sinMateria = [];   // CSV no resuelve materia
  const sinHoraEnCsv = [];

  for (const s of slots) {
    const mid = resolverMateriaId(s);
    if (mid == null) { sinMateria.push(s); continue; }
    const db = idx.get(`${s.clave_grupo}|${s.tipo}|${mid}`);
    if (!db) { sinMatch.push(s); continue; }
    if (vacio(s.hora_inicio) && vacio(s.hora_fin)) { sinHoraEnCsv.push(s); continue; }

    const setHi = vacio(db.hora_inicio) && !vacio(s.hora_inicio);
    const setHf = vacio(db.hora_fin) && !vacio(s.hora_fin);
    // conflicto REAL: ambos tienen valor y, ya normalizado el formato, difieren.
    const choqueHi = !vacio(db.hora_inicio) && !vacio(s.hora_inicio) &&
      normHora(db.hora_inicio) !== normHora(s.hora_inicio);
    const choqueHf = !vacio(db.hora_fin) && !vacio(s.hora_fin) &&
      normHora(db.hora_fin) !== normHora(s.hora_fin);

    if (choqueHi || choqueHf) {
      conflictos.push({ db, s });
      continue; // NO se pisa
    }
    const setDia = vacio(db.dia) && !vacio(s.dia);
    const setTurno = vacio(db.turno) && !vacio(s.turno);
    if (setHi || setHf || setDia || setTurno) {
      aLlenar.push({
        id: db.id, plantel: db.plantel,
        hora_inicio: setHi ? normHora(s.hora_inicio) : null,
        hora_fin: setHf ? normHora(s.hora_fin) : null,
        dia: setDia ? s.dia : null,
        turno: setTurno ? s.turno : null,
        _ref: `${s.clave_grupo} ${s.tipo} ${s.materia}`,
      });
    } else {
      yaOk.push(s);
    }
  }

  const porPlantel = (arr) => {
    const m = {};
    for (const x of arr) { const p = x.plantel || x.s?.db?.plantel || "?"; m[p] = (m[p] ?? 0) + 1; }
    return m;
  };

  console.log("=".repeat(74));
  console.log(`PARCHE DE HORARIOS — ciclo ${CICLO.nombre} (${CICLO.codigo}) — ${CONFIRMAR ? "APLICAR" : "VISTA PREVIA"}`);
  console.log("=".repeat(74));
  console.log(`\nFilas en CSV: ${slots.length}   slots en base (septiembre): ${dbslots.length}`);
  console.log(`\n● A RELLENAR (slots con hueco que el CSV completa): ${aLlenar.length}`);
  console.log("   por plantel:", porPlantel(aLlenar));
  console.log(`● Ya estaban correctos:        ${yaOk.length}`);
  console.log(`● Sin horario en el CSV:       ${sinHoraEnCsv.length}`);
  console.log(`● CONFLICTO (base ≠ CSV, NO se toca): ${conflictos.length}`);
  console.log(`● Sin slot que empate:         ${sinMatch.length}`);
  console.log(`● Materia no resuelta:         ${sinMateria.length}`);

  if (conflictos.length) {
    console.log(`\n  ⚠ Conflictos (se dejan como están; revísalos):`);
    for (const { db, s } of conflictos.slice(0, 20))
      console.log(`     ${db.clave} ${db.tipo}: base=${db.hora_inicio}-${db.hora_fin}  csv=${s.hora_inicio}-${s.hora_fin}`);
    if (conflictos.length > 20) console.log(`     ... y ${conflictos.length - 20} más`);
  }
  if (aLlenar.length) {
    console.log(`\n  Ejemplos de lo que se rellenaría:`);
    for (const x of aLlenar.slice(0, 10))
      console.log(`     ${x._ref}  ->  ${x.hora_inicio ?? "·"}-${x.hora_fin ?? "·"}${x.dia ? " dia:" + x.dia : ""}${x.turno ? " turno:" + x.turno : ""}`);
  }

  if (!CONFIRMAR) {
    console.log("\n🧪 VISTA PREVIA: no se tocó la base. Para aplicar: --confirmar");
    process.exit(0);
  }

  await c.query("begin");
  let n = 0;
  for (const x of aLlenar) {
    await c.query(
      `update slots set
         hora_inicio = coalesce($2, hora_inicio),
         hora_fin    = coalesce($3, hora_fin),
         dia         = coalesce($4, dia),
         turno       = coalesce($5, turno)
       where id = $1`,
      [x.id, x.hora_inicio, x.hora_fin, x.dia, x.turno]);
    n++;
  }
  await c.query("commit");
  console.log(`\n✅ Listo: ${n} slots actualizados. Ningún slot ni asignación se borró.`);
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("❌ Falló (ROLLBACK, base intacta):", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
