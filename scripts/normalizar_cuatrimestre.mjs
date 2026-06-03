// Normaliza el cuatrimestre a formato canónico "N°" (1°–9°).
// Los datos llegaron sucios del Excel: el mismo nivel escrito de varias formas
// ("3°" y "3RO", "2°"/"2DO", "4°"/"4TO"/"4.0", "9NO A/B"…). Eso separa barras en
// los dashboards "por cuatrimestre". Aquí lo unificamos en slots y en grupos.
// Regla: tomamos el primer dígito 1–9 del texto y lo volvemos "N°".
// Uso: node scripts/normalizar_cuatrimestre.mjs            (PRUEBA, no escribe)
//      node scripts/normalizar_cuatrimestre.mjs --aplicar  (escribe de verdad)
import pg from "pg";
import { loadEnv } from "./_env.mjs";

const APLICAR = process.argv.includes("--aplicar");
const db = new pg.Client({ connectionString: loadEnv().SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();

// "3RO" -> "3°", "4.0" -> "4°", "9NO A" -> "9°". Si no hay dígito 1–9, lo dejamos igual.
const canon = (raw) => {
  if (raw == null) return null;
  const m = String(raw).match(/[1-9]/);
  return m ? `${m[0]}°` : String(raw).trim() || null;
};

console.log(`\n=== NORMALIZAR CUATRIMESTRE — modo ${APLICAR ? "APLICAR (escribe)" : "PRUEBA (no escribe)"} ===\n`);

try {
  await db.query("begin");

  // --- diagnóstico: qué formas existen y a qué se mapearán ---
  const distintos = (await db.query(
    `select cuatrimestre, count(*)::int n from slots where not es_historial
      group by cuatrimestre order by cuatrimestre`)).rows;

  const mapa = new Map(); // canónico -> {fuentes:Set, total}
  for (const { cuatrimestre, n } of distintos) {
    const c = canon(cuatrimestre);
    if (!mapa.has(c)) mapa.set(c, { fuentes: new Set(), total: 0 });
    const e = mapa.get(c);
    e.fuentes.add(`${JSON.stringify(cuatrimestre)}×${n}`);
    e.total += n;
  }
  console.log("  Mapeo (formas encontradas → canónico):");
  for (const [c, e] of [...mapa.entries()].sort()) {
    console.log(`   • ${c}  ←  ${[...e.fuentes].join(", ")}   (${e.total} clases)`);
  }

  // --- aplica normalización donde el valor cambie ---
  let slotsCambiados = 0, gruposCambiados = 0;
  for (const { cuatrimestre } of distintos) {
    const c = canon(cuatrimestre);
    if (c === cuatrimestre) continue; // ya está canónico
    const s = cuatrimestre == null
      ? { rowCount: 0 }
      : await db.query("update slots set cuatrimestre=$1 where cuatrimestre=$2 and not es_historial", [c, cuatrimestre]);
    slotsCambiados += s.rowCount;
  }
  // grupos.cuatrimestre también
  const gruposDistintos = (await db.query(
    `select distinct cuatrimestre from grupos where cuatrimestre is not null`)).rows;
  for (const { cuatrimestre } of gruposDistintos) {
    const c = canon(cuatrimestre);
    if (c === cuatrimestre) continue;
    const g = await db.query("update grupos set cuatrimestre=$1 where cuatrimestre=$2", [c, cuatrimestre]);
    gruposCambiados += g.rowCount;
  }

  const formasAntes = distintos.length;
  const formasDespues = mapa.size;
  console.log(`\n  Resumen: ${slotsCambiados} slots y ${gruposCambiados} grupos renombrados`);
  console.log(`  Formas distintas de cuatrimestre: ${formasAntes} → ${formasDespues}`);

  if (APLICAR) {
    await db.query("commit");
    console.log(`\n  ✅ Cambios GUARDADOS.\n`);
  } else {
    await db.query("rollback");
    console.log(`\n  🔍 PRUEBA: nada se guardó. Corre con --aplicar para escribir.\n`);
  }
} catch (e) {
  await db.query("rollback");
  console.error(`\n  ❌ Error, se revirtió todo:`, e.message, "\n");
  process.exitCode = 1;
} finally {
  await db.end();
}
