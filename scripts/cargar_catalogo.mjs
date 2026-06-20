// CARGA del catálogo para Sep-Dic 2026: da de alta las MATERIAS NUEVAS y deja listo el
// MAPA DE ALIAS (typo escrito en la propuesta -> materia que ya existe en el catálogo).
//
// Por defecto corre en VISTA PREVIA (no escribe nada): muestra exactamente qué insertaría
// y qué corregiría. Con --confirmar inserta las materias nuevas y escribe el mapa de alias.
//
//   node scripts/cargar_catalogo.mjs              -> vista previa (no toca la base)
//   node scripts/cargar_catalogo.mjs --confirmar  -> inserta materias nuevas + guarda alias
//
// Lee:  db/seed_data/materias_a_revisar.json  (salida de clasificar_materias.py)
// Escribe (solo con --confirmar): inserts en materias + db/seed_data/alias_materias.json
import { loadEnv } from "./_env.mjs";
import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const REVISAR = join(RAIZ, "db", "seed_data", "materias_a_revisar.json");
const ALIAS_OUT = join(RAIZ, "db", "seed_data", "alias_materias.json");
const CONFIRMAR = process.argv.includes("--confirmar");

const norm = (s) => (s || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const slugify = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

// La máquina marcó estas 4 como "typo" pero son materias DISTINTAS (validado por Sergio):
// se tratan como NUEVAS, no se corrigen al catálogo. Se comparan por slug (sin acentos).
const FORZAR_NUEVA = new Set([
  "introduccion-a-la-ingenieria-mecatronica",
  "proyectos-de-inversion",
  "desarrollo-psicologico-en-la-adolescencia",
  "ingles-iii",
]);

// Materias a NO dar de alta (basura / celdas cortadas).
const QUITAR = new Set(["sem"]);

// Fusiones decididas por Sergio: [escrito tal cual] -> [nombre canónico final].
// El canónico se da de alta como materia nueva; los demás quedan como alias hacia él.
const MERGES = [
  ["IVA", "IVA, IMPUESTOS ESPECIALES Y LOCALES"],
  ["IMPUESTOS ESPECIALES Y LOCALES", "IVA, IMPUESTOS ESPECIALES Y LOCALES"],
  ["BIOQUIMICA E LOS ALIMENTOS", "BIOQUIMICA DE LOS ALIMENTOS"],
];

// Limpieza ortográfica del catálogo viejo: [slug actual en la base] -> [nombre corregido].
// Si el slug corregido cambia, se agrega alias del slug viejo al nuevo para no romper enlaces.
const LIMPIAR_CATALOGO = [
  ["liderazgo-y-dirrecion", "LIDERAZGO Y DIRECCIÓN"],
  ["planeacion-estretegica-y-operativa", "PLANEACIÓN ESTRATÉGICA Y OPERATIVA"],
  ["evaluacion-de-desempeno-laboral", "EVALUACIÓN DE DESEMPEÑO LABORAL"],
  ["practicas-de-reposteria", "PRÁCTICAS DE REPOSTERÍA"],
];

const mergeAliasSlugs = new Set(MERGES.map(([a]) => slugify(a)));

const rev = JSON.parse(readFileSync(REVISAR, "utf8"));

// Reclasificar: sacar los 4 falsos-typo del bucket typos y mandarlos a nuevas.
const typos = [];
const nuevas = [...rev.materias_nuevas];
for (const t of rev.typos_probables) {
  if (FORZAR_NUEVA.has(slugify(t.materia))) nuevas.push({ ...t, _reclasificada: true });
  else typos.push(t);
}

const pool = new pg.Pool({ connectionString: loadEnv().SUPABASE_DB_URL, max: 2 });
const c = await pool.connect();
try {
  const { rows: cat } = await c.query(`select id, nombre, slug from materias`);
  const porSlug = new Map(cat.map((m) => [m.slug, m]));

  // --- LIMPIEZA del catálogo viejo: renombra y, si cambia el slug, registra el cambio ---
  const limpiezas = [];
  const slugCambiado = new Map(); // slug_viejo -> slug_nuevo (para no romper enlaces por slug)
  for (const [slugViejo, nombreNuevo] of LIMPIAR_CATALOGO) {
    const fila = porSlug.get(slugViejo);
    if (!fila) { limpiezas.push({ slugViejo, nombreNuevo, estado: "NO ENCONTRADO" }); continue; }
    const slugNuevo = slugify(nombreNuevo);
    const colision = slugNuevo !== slugViejo && porSlug.has(slugNuevo);
    limpiezas.push({ id: fila.id, antes: fila.nombre, despues: nombreNuevo,
                     slugViejo, slugNuevo, cambiaSlug: slugNuevo !== slugViejo,
                     estado: colision ? "COLISIÓN" : "ok" });
    if (slugNuevo !== slugViejo) slugCambiado.set(slugViejo, slugNuevo);
  }
  const slugFinal = (s) => slugCambiado.get(s) ?? s; // resuelve al slug ya corregido

  // --- ALTAS: materias nuevas, sin las fusionadas, sin basura, sin duplicar ---
  const altas = [];
  const yaExisten = [];
  const vistos = new Set();
  for (const n of nuevas) {
    const nombre = norm(n.materia);
    const slug = slugify(nombre);
    if (QUITAR.has(slug)) continue;            // basura (SEM)
    if (mergeAliasSlugs.has(slug)) continue;   // se fusiona; no se inserta como propia
    if (porSlug.has(slug)) { yaExisten.push(nombre); continue; }
    if (vistos.has(slug)) continue;            // dup dentro de la lista
    vistos.add(slug);
    altas.push({ nombre, slug, veces: n.veces, cercano: n.sugerencia_catalogo,
                 parecido: n.parecido, reclasificada: !!n._reclasificada });
  }

  // --- ALIAS = typos + fusiones + cambios de slug por limpieza ---
  // valor del alias = slug canónico final (el cargador de demanda lo resuelve contra el catálogo)
  const alias = {};       // escrito_slug -> slug_canonico
  const aliasInfo = [];   // para el reporte
  const aliasRotos = [];
  const nombreLimpio = new Map(limpiezas.filter(l => l.id).map(l => [l.slugViejo, l.despues]));
  for (const t of typos) {
    const destino = porSlug.get(slugify(t.sugerencia_catalogo));
    if (!destino) { aliasRotos.push(t); continue; }
    const destinoSlug = slugFinal(destino.slug);
    alias[slugify(t.materia)] = destinoSlug;
    aliasInfo.push({ tipo: "typo", de: norm(t.materia),
                     a: nombreLimpio.get(destino.slug) ?? destino.nombre, veces: t.veces });
  }
  for (const [escrito, canon] of MERGES) {
    alias[slugify(escrito)] = slugify(canon);
    aliasInfo.push({ tipo: "fusión", de: norm(escrito), a: norm(canon), veces: null });
  }
  for (const [viejo, nuevo] of slugCambiado) {
    alias[viejo] = nuevo;
    aliasInfo.push({ tipo: "slug-limpio", de: viejo, a: nuevo, veces: null });
  }

  // --- REPORTE ---
  console.log("=".repeat(74));
  console.log(`CARGA DE CATÁLOGO — ${CONFIRMAR ? "APLICAR" : "VISTA PREVIA (no escribe nada)"}`);
  console.log("=".repeat(74));

  console.log(`\n● ALTAS — materias nuevas a insertar: ${altas.length}`);
  for (const a of altas.sort((x, y) => y.veces - x.veces)) {
    console.log(`   ${String(a.veces).padStart(3)}×  ${a.nombre}   [slug: ${a.slug}]`);
  }
  if (yaExisten.length) console.log(`\n  (${yaExisten.length} ya existían, se omiten: ${yaExisten.join(", ")})`);

  console.log(`\n● LIMPIEZA del catálogo viejo: ${limpiezas.length}`);
  for (const l of limpiezas) {
    const marca = l.estado === "ok" ? (l.cambiaSlug ? " (slug cambia)" : " (solo acentos)")
      : `  ⚠ ${l.estado}`;
    console.log(`   "${l.antes ?? l.slugViejo}"  →  "${l.despues ?? l.nombreNuevo}"${marca}`);
  }

  console.log(`\n● CORRECCIONES (alias) — typos + fusiones + slug limpio: ${aliasInfo.length}`);
  for (const a of aliasInfo.sort((x, y) => (y.veces ?? -1) - (x.veces ?? -1))) {
    const v = a.veces != null ? `${String(a.veces).padStart(3)}× ` : "      ";
    console.log(`   ${v}[${a.tipo}] ${a.de}  →  ${a.a}`);
  }
  if (aliasRotos.length) {
    console.log(`\n  ⚠ ${aliasRotos.length} correcciones con destino inexistente (revisar):`);
    for (const t of aliasRotos) console.log(`     ${t.materia} → ${t.sugerencia_catalogo}`);
  }

  if (!CONFIRMAR) {
    console.log("\n🧪 VISTA PREVIA: no se tocó la base ni se escribió el mapa de alias.");
    console.log("   Para aplicar de verdad: agrega --confirmar");
    process.exit(0);
  }

  // --- APLICAR (todo en una transacción) ---
  if (limpiezas.some((l) => l.estado === "COLISIÓN")) {
    throw new Error("Hay colisión de slug en la limpieza; resolver antes de aplicar.");
  }
  await c.query("begin");
  for (const a of altas) {
    await c.query(`insert into materias (nombre, slug) values ($1,$2) on conflict (slug) do nothing`,
      [a.nombre, a.slug]);
  }
  for (const l of limpiezas) {
    if (l.estado !== "ok") continue;
    await c.query(`update materias set nombre=$1, slug=$2 where id=$3`, [l.despues, l.slugNuevo, l.id]);
  }
  await c.query("commit");
  writeFileSync(ALIAS_OUT, JSON.stringify({ generado: new Date().toISOString(), alias }, null, 2));
  console.log(`\n✅ Insertadas ${altas.length} materias, limpiadas ${limpiezas.filter(l=>l.estado==="ok").length}. Alias (${Object.keys(alias).length}) en ${ALIAS_OUT}`);
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("❌ Falló (ROLLBACK, base intacta):", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
