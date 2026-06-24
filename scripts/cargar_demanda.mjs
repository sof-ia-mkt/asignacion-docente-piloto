// CARGA de la DEMANDA real de Sep-Dic 2026: reemplaza los slots placeholder del ciclo
// de planeación (septiembre) por los 1,288 reales que salieron de la propuesta.
//
// Por defecto VISTA PREVIA (no escribe): muestra qué insertaría, qué grupos/planes crearía,
// cuántas materias casan con el catálogo y qué se borraría. Con --confirmar aplica todo en
// una sola transacción (si algo falla, ROLLBACK y la base queda intacta).
//
//   node scripts/cargar_demanda.mjs              -> vista previa
//   node scripts/cargar_demanda.mjs --confirmar  -> aplica
//
// Lee:  db/seed_data/demanda_sepdic2026.json  (extraer_demanda.py)
//       db/seed_data/alias_materias.json       (cargar_catalogo.mjs --confirmar)
import { loadEnv } from "./_env.mjs";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEMANDA = join(RAIZ, "db", "seed_data", "demanda_sepdic2026.json");
const ALIAS = join(RAIZ, "db", "seed_data", "alias_materias.json");
const CONFIRMAR = process.argv.includes("--confirmar");

const norm = (s) => (s || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const slugify = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

// carrera limpia (de la demanda) -> nombre canónico de plan. Evita meter las 21 variantes
// sucias de plan_raw a la tabla de planes.
const PLAN_CANON = {
  "ADMINISTRACIÓN": "LICENCIATURA EN ADMINISTRACIÓN DE EMPRESAS",
  "CIENCIAS DE LA EDUCACIÓN": "LICENCIATURA EN CIENCIAS DE LA EDUCACIÓN",
  "CONTADURÍA PÚBLICA Y FINANZAS": "LICENCIATURA EN CONTADURÍA PÚBLICA Y FINANZAS",
  "CRIMINOLOGÍA Y CRIMINALÍSTICA": "LICENCIATURA EN CRIMINOLOGÍA Y CRIMINALÍSTICA",
  "DERECHO": "LICENCIATURA EN DERECHO",
  "GASTRONOMÍA": "LICENCIATURA EN GASTRONOMÍA",
  "INGENIERÍA ELECTROMECÁNICA": "LICENCIATURA EN INGENIERÍA ELECTROMECÁNICA",
  "INGENIERÍA EN SISTEMAS COMPUTACIONALES": "LICENCIATURA EN INGENIERÍA EN SISTEMAS COMPUTACIONALES",
  "INGENIERÍA INDUSTRIAL": "LICENCIATURA EN INGENIERÍA INDUSTRIAL",
  "INGENIERÍA MECATRÓNICA": "LICENCIATURA EN INGENIERÍA MECATRÓNICA",
  "PSICOLOGÍA ORGANIZACIONAL": "LICENCIATURA EN PSICOLOGÍA ORGANIZACIONAL",
};

// Alias de variantes SUCIAS conocidas del Excel (slug -> llave de PLAN_CANON). Estas
// son las que históricamente crearon planes duplicados ("INGENERIA…" sin la 2ª i, etc.).
const PLAN_ALIAS = {
  "ingeneria-electromecanica": "INGENIERÍA ELECTROMECÁNICA",
  "ingeneria-industrial": "INGENIERÍA INDUSTRIAL",
  "ingeneria-mecatronica": "INGENIERÍA MECATRÓNICA",
  "ingeneria-sistemas-computacionale-s": "INGENIERÍA EN SISTEMAS COMPUTACIONALES",
  "ingeneria-sistemas-computacionales": "INGENIERÍA EN SISTEMAS COMPUTACIONALES",
  "ingenieria-sistemas-computacionales": "INGENIERÍA EN SISTEMAS COMPUTACIONALES",
  "administracion-de-empresas": "ADMINISTRACIÓN",
};

// Índice de las llaves canónicas por slug (tolera acentos/mayúsculas/espacios).
const planKeyBySlug = new Map(Object.keys(PLAN_CANON).map((k) => [slugify(k), k]));

// Carreras que no resolvimos a ningún plan canónico: se reportan y BLOQUEAN el --confirmar
// (nunca insertamos un plan sucio en silencio; un humano debe agregar el alias).
const carrerasDesconocidas = new Set();

// carrera (cruda del Excel) -> nombre canónico de plan. Orden: exacto -> slug -> alias typo.
function planCanonico(carrera) {
  const n = norm(carrera);
  if (PLAN_CANON[n]) return PLAN_CANON[n];
  const sl = slugify(n);
  if (planKeyBySlug.has(sl)) return PLAN_CANON[planKeyBySlug.get(sl)];
  if (PLAN_ALIAS[sl]) return PLAN_CANON[PLAN_ALIAS[sl]];
  carrerasDesconocidas.add(n);
  return `LICENCIATURA EN ${n}`; // último recurso; el --confirmar abortará por estar en la lista
}

const dem = JSON.parse(readFileSync(DEMANDA, "utf8"));
const aliasMap = JSON.parse(readFileSync(ALIAS, "utf8")).alias ?? {};
const slots = dem.slots;

const pool = new pg.Pool({ connectionString: loadEnv().SUPABASE_DB_URL, max: 2 });
const c = await pool.connect();
try {
  // --- ciclo de planeación (septiembre) ---
  const { rows: cic } = await c.query(
    `select id, codigo, nombre from ciclos where estado='planeacion' order by es_activo desc, orden desc limit 1`);
  if (!cic.length) throw new Error("No hay ciclo en estado 'planeacion'.");
  const CICLO = cic[0];

  // --- catálogo de materias (slug -> id) y planes existentes (slug -> id) ---
  const { rows: cat } = await c.query(`select id, slug from materias`);
  const matBySlug = new Map(cat.map((m) => [m.slug, m.id]));
  const { rows: pls } = await c.query(`select id, slug from planes`);
  const planBySlug = new Map(pls.map((p) => [p.slug, p.id]));
  const { rows: grs } = await c.query(`select id, clave from grupos`);
  const grpByClave = new Map(grs.map((g) => [g.clave, g.id]));

  // resolver materia: canónica -> alias -> id
  const resolverMateria = (s) => {
    let sl = slugify(s.materia_canonica || s.materia);
    if (aliasMap[sl]) sl = aliasMap[sl];
    return matBySlug.get(sl) ?? null;
  };

  // --- qué planes / grupos nuevos hacen falta ---
  const planesNecesarios = new Map();  // slug -> nombre canónico
  for (const s of slots) {
    const nombre = planCanonico(s.carrera);
    planesNecesarios.set(slugify(nombre), nombre);
  }
  const planesNuevos = [...planesNecesarios].filter(([sl]) => !planBySlug.has(sl));

  const gruposDemanda = new Map();     // clave -> {cuatri, turno, planSlug}
  for (const s of slots) {
    if (gruposDemanda.has(s.clave_grupo)) continue;
    const nombre = planCanonico(s.carrera);
    gruposDemanda.set(s.clave_grupo, {
      cuatrimestre: s.cuatrimestre || null, turno: s.turno || null, planSlug: slugify(nombre),
    });
  }
  const gruposNuevos = [...gruposDemanda].filter(([cl]) => !grpByClave.has(cl));
  const gruposReusados = [...gruposDemanda].filter(([cl]) => grpByClave.has(cl));

  // --- materias: cuántas casan ---
  let casan = 0; const sinMateria = new Map();
  for (const s of slots) {
    if (resolverMateria(s)) casan++;
    else { const k = norm(s.materia); sinMateria.set(k, (sinMateria.get(k) ?? 0) + 1); }
  }

  // --- qué se borra ---
  const [{ n: borraSlots }] = (await c.query(
    `select count(*)::int n from slots where ciclo_id=$1`, [CICLO.id])).rows;
  const [{ n: borraAsig }] = (await c.query(
    `select count(*)::int n from asignaciones a join slots s on s.id=a.slot_id where s.ciclo_id=$1`,
    [CICLO.id])).rows;

  // --- REPORTE ---
  console.log("=".repeat(74));
  console.log(`CARGA DE DEMANDA — ciclo ${CICLO.nombre} (${CICLO.codigo}) — ${CONFIRMAR ? "APLICAR" : "VISTA PREVIA"}`);
  console.log("=".repeat(74));
  console.log(`\n● A INSERTAR: ${slots.length} slots, ${gruposDemanda.size} grupos`);
  console.log(`● PLANES nuevos: ${planesNuevos.length}` + (planesNuevos.length ? "  → " + planesNuevos.map(([, n]) => n).join(" | ") : ""));
  console.log(`● GRUPOS: ${gruposNuevos.length} nuevos, ${gruposReusados.length} ya existían (se reutilizan)`);
  console.log(`● MATERIAS: ${casan}/${slots.length} casan con el catálogo  (${slots.length - casan} sin materia)`);
  if (sinMateria.size) {
    console.log(`\n  ⚠ Materias que NO casan (${sinMateria.size} distintas):`);
    for (const [m, n] of [...sinMateria].sort((a, b) => b[1] - a[1]))
      console.log(`     ${String(n).padStart(3)}×  ${m}`);
  }
  console.log(`\n● A BORRAR del ciclo: ${borraSlots} slots placeholder` +
    (borraAsig ? ` y ${borraAsig} asignaciones (incluye las de prueba)` : ""));

  // Carreras que no resolvieron a un plan canónico: bloquean la carga para no
  // reintroducir planes duplicados/sucios. Hay que agregarlas a PLAN_CANON o PLAN_ALIAS.
  if (carrerasDesconocidas.size) {
    console.log(`\n‼️ CARRERAS DESCONOCIDAS (${carrerasDesconocidas.size}) — no casan con PLAN_CANON ni PLAN_ALIAS:`);
    for (const n of [...carrerasDesconocidas].sort())
      console.log(`     · "${n}"  (slug: ${slugify(n)})`);
    console.log("   → Agrega cada una a PLAN_ALIAS (si es typo) o a PLAN_CANON (si es carrera nueva).");
  }

  if (!CONFIRMAR) {
    console.log("\n🧪 VISTA PREVIA: no se tocó la base. Para aplicar: --confirmar");
    process.exit(0);
  }
  if (carrerasDesconocidas.size) {
    throw new Error(`Carga abortada: ${carrerasDesconocidas.size} carrera(s) sin mapear. ` +
      "Agrega los alias antes de --confirmar (ver lista arriba).");
  }

  // --- APLICAR (una transacción) ---
  await c.query("begin");

  // planes nuevos
  for (const [sl, nombre] of planesNuevos) {
    const { rows } = await c.query(
      `insert into planes (nombre, slug) values ($1,$2)
         on conflict (slug) do update set slug=excluded.slug returning id`, [nombre, sl]);
    planBySlug.set(sl, rows[0].id);
  }

  // grupos nuevos
  for (const [clave, g] of gruposNuevos) {
    const { rows } = await c.query(
      `insert into grupos (clave, plan_id, cuatrimestre, turno) values ($1,$2,$3,$4)
         on conflict (clave) do update set clave=excluded.clave returning id`,
      [clave, planBySlug.get(g.planSlug) ?? null, g.cuatrimestre, g.turno]);
    grpByClave.set(clave, rows[0].id);
  }

  // fuera con los placeholder (cascade borra asignaciones y alertas de esos slots)
  await c.query(`delete from slots where ciclo_id=$1`, [CICLO.id]);

  // insertar la demanda real
  const cols = ["plantel", "ciclo", "ciclo_id", "es_historial", "plan_id", "grupo_id", "materia_id",
    "cuatrimestre", "tipo", "modalidad", "dia", "turno", "hora_inicio", "hora_fin", "fecha_raw"];
  let insertados = 0;
  const CHUNK = 200;
  for (let i = 0; i < slots.length; i += CHUNK) {
    const lote = slots.slice(i, i + CHUNK);
    const vals = []; const ph = [];
    lote.forEach((s, j) => {
      const nombrePlan = planCanonico(s.carrera);
      const fila = [
        s.plantel || "CASA BLANCA", CICLO.codigo, CICLO.id, false,
        planBySlug.get(slugify(nombrePlan)) ?? null,
        grpByClave.get(s.clave_grupo) ?? null,
        resolverMateria(s),
        s.cuatrimestre || null, s.tipo || null,
        s.tipo === "VIRTUAL" ? "ASINCRÓNICA" : "PRESENCIAL",
        s.dia || null, s.turno || null,
        s.hora_inicio || null, s.hora_fin || null,
        (s.fechas || "").trim() || null,
      ];
      const base = j * cols.length;
      ph.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(",")})`);
      vals.push(...fila);
    });
    await c.query(`insert into slots (${cols.join(",")}) values ${ph.join(",")}`, vals);
    insertados += lote.length;
  }

  await c.query("commit");
  console.log(`\n✅ Listo: borrados ${borraSlots} placeholder, insertados ${insertados} slots reales.`);
  console.log(`   Planes nuevos: ${planesNuevos.length} · grupos nuevos: ${gruposNuevos.length}`);
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("❌ Falló (ROLLBACK, base intacta):", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
