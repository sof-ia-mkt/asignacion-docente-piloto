// CARGA de la DISPONIBILIDAD docente (formulario Sep-Dic 2026):
//   - da de alta / actualiza los 78 docentes que respondieron (correo + horarios declarados)
//   - por cada materia que el docente dijo poder dar, registra un CANDIDATO fuerte
//     (materia_candidatos, fuente='disponibilidad', puntaje 50): es la señal más actual,
//     el propio docente lo pidió para ESTE ciclo. El motor la propone; coordinación decide.
//
// Por defecto VISTA PREVIA (no escribe). Con --confirmar aplica en una transacción.
//
//   node scripts/cargar_disponibilidad.mjs              -> vista previa
//   node scripts/cargar_disponibilidad.mjs --confirmar  -> aplica
//
// Lee:  db/seed_data/disponibilidad_sepdic2026.json  (extraer_disponibilidad.py)
//       db/seed_data/alias_materias.json              (cargar_catalogo.mjs --confirmar)
import { loadEnv } from "./_env.mjs";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DISPO = join(RAIZ, "db", "seed_data", "disponibilidad_sepdic2026.json");
const ALIAS = join(RAIZ, "db", "seed_data", "alias_materias.json");
const CONFIRMAR = process.argv.includes("--confirmar");
const PUNTAJE = 50;   // "lo pidió el docente": señal más fuerte que historial (40) y cv-alta (25)

const norm = (s) => (s || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const slugify = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

// La base guarda el nombre como "APELLIDO_PATERNO APELLIDO_MATERNO NOMBRES"; el formulario
// lo trae al revés y en campos separados. Emparejamos por tokens (sin acentos), exigiendo
// ambos apellidos + primer nombre; si hay varios (duplicados viejos en la base), desempata
// quien comparta más tokens y, en empate, quien empiece por el apellido paterno.
const tokens = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z]+/).filter((w) => w.length > 1);
const emparejar = (d, exIdx) => {
  const ap = tokens(d.apellido_paterno), am = tokens(d.apellido_materno), nm = tokens(d.nombres);
  const req = [...ap, ...am, nm[0]].filter(Boolean);
  if (!req.length) return null;
  const hits = exIdx.filter((p) => req.every((t) => p.T.has(t)));
  if (hits.length <= 1) return hits[0] ?? null;
  const full = new Set([...ap, ...am, ...nm]);
  const inter = (p) => [...full].filter((t) => p.T.has(t)).length;
  const apPat = (ap[0] || "").toUpperCase();
  return [...hits].sort((a, b) =>
    inter(b) - inter(a) || (b.nombre.startsWith(apPat) - a.nombre.startsWith(apPat)))[0];
};
const nombreCanonico = (d) =>
  [d.apellido_paterno, d.apellido_materno, d.nombres].map((s) => (s || "").trim()).filter(Boolean).join(" ")
    .replace(/\s+/g, " ").toUpperCase() || norm(d.nombre);

const data = JSON.parse(readFileSync(DISPO, "utf8"));
const aliasMap = JSON.parse(readFileSync(ALIAS, "utf8")).alias ?? {};
const docentes = data.docentes;

const pool = new pg.Pool({ connectionString: loadEnv().SUPABASE_DB_URL, max: 2 });
const c = await pool.connect();
try {
  const { rows: cat } = await c.query(`select id, slug from materias`);
  const matBySlug = new Map(cat.map((m) => [m.slug, m.id]));
  const { rows: pr } = await c.query(`select id, nombre, slug, correo from profesores`);
  const exIdx = pr.map((p) => ({ ...p, T: new Set(tokens(p.nombre)) }));
  // resuelve el form docente -> profesor existente (o null si es nuevo)
  const matchDe = new Map();   // d.slug -> profesor existente | null
  for (const d of docentes) matchDe.set(d.slug, emparejar(d, exIdx));

  const resolverMateria = (m) => {
    let sl = slugify(m.canonica || m.materia);
    if (aliasMap[sl]) sl = aliasMap[sl];
    return matBySlug.get(sl) ?? null;
  };

  // --- analizar ---
  let nuevos = 0, existentes = 0;
  const candidatos = [];               // {slug, materia_id, razon}
  const sinMateria = new Map();
  const vistos = new Set();             // dedup por docente+materia
  for (const d of docentes) {
    if (matchDe.get(d.slug)) existentes++; else nuevos++;
    for (const [carrera, info] of Object.entries(d.carreras || {})) {
      for (const m of (info.materias || [])) {
        const mid = resolverMateria(m);
        if (!mid) { const k = norm(m.materia); sinMateria.set(k, (sinMateria.get(k) ?? 0) + 1); continue; }
        const k = `${d.slug}|${mid}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        candidatos.push({ slug: d.slug, materia_id: mid,
          razon: `Lo solicitó en el formulario de disponibilidad (${norm(carrera)})` });
      }
    }
  }

  console.log("=".repeat(74));
  console.log(`CARGA DE DISPONIBILIDAD — ${CONFIRMAR ? "APLICAR" : "VISTA PREVIA"}`);
  console.log("=".repeat(74));
  console.log(`\n● DOCENTES en el formulario: ${docentes.length}  (${nuevos} nuevos, ${existentes} ya existían)`);
  console.log(`● CANDIDATOS fuertes a registrar (puntaje ${PUNTAJE}): ${candidatos.length}`);
  console.log(`● MATERIAS declaradas que NO casan con el catálogo: ${sinMateria.size} distintas` +
    (sinMateria.size ? ` (${[...sinMateria.values()].reduce((a, b) => a + b, 0)} menciones)` : ""));
  if (sinMateria.size) {
    for (const [m, n] of [...sinMateria].sort((a, b) => b[1] - a[1]).slice(0, 20))
      console.log(`     ${String(n).padStart(3)}×  ${m}`);
  }

  if (!CONFIRMAR) {
    console.log("\n🧪 VISTA PREVIA: no se tocó la base. Para aplicar: --confirmar");
    process.exit(0);
  }

  // --- APLICAR ---
  await c.query("begin");
  const idDe = new Map();   // d.slug -> profesor_id (existente emparejado o recién creado)
  for (const d of docentes) {
    const dispo = {
      marca_temporal: d.marca_temporal ?? null, grado: d.grado ?? null,
      grados_texto: d.grados_texto ?? null, planteles: d.planteles ?? [],
      horarios: d.horarios ?? [], comentarios: d.comentarios ?? "",
    };
    const correo = d.correo_valido ? d.correo : null;
    const ex = matchDe.get(d.slug);
    if (ex) {
      await c.query(
        `update profesores set disponibilidad=$1, correo=coalesce(correo,$2) where id=$3`,
        [dispo, correo, ex.id]);
      idDe.set(d.slug, ex.id);
    } else {
      const nombre = nombreCanonico(d);
      const slug = slugify(nombre);
      const { rows } = await c.query(
        `insert into profesores (nombre, slug, correo, disponibilidad) values ($1,$2,$3,$4)
           on conflict (slug) do update set disponibilidad=excluded.disponibilidad,
             correo=coalesce(profesores.correo,excluded.correo) returning id`,
        [nombre, slug, correo, dispo]);
      idDe.set(d.slug, rows[0].id);
    }
  }
  let ins = 0;
  for (const cd of candidatos) {
    const pid = idDe.get(cd.slug);
    await c.query(
      `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
         values ($1,$2,'disponibilidad',$3,$4)
         on conflict (profesor_id, materia_id)
         do update set puntaje=greatest(materia_candidatos.puntaje, excluded.puntaje)`,
      [pid, cd.materia_id, PUNTAJE, cd.razon]);
    ins++;
  }
  await c.query("commit");
  console.log(`\n✅ Listo: ${nuevos} docentes nuevos, ${existentes} actualizados, ${ins} candidatos de disponibilidad registrados.`);
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("❌ Falló (ROLLBACK, base intacta):", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
