// RESTAURA la base desde un respaldo hecho con respaldo_db.mjs.
// ⚠️ DESTRUCTIVO: BORRA TODO el contenido actual de las tablas y lo reemplaza por el del backup.
// Por eso exige la bandera --confirmar. Todo ocurre en UNA transacción: si algo falla, no se
// aplica nada (la base queda como estaba). Inserta en orden FK-seguro y resetea las secuencias.
//
//   node scripts/restaurar_db.mjs backups/respaldo_2026-06-03-16-40-00.json.gz             -> ENSAYO (no escribe)
//   node scripts/restaurar_db.mjs backups/respaldo_2026-06-03-16-40-00.json.gz --confirmar -> RESTAURA de verdad
import { loadEnv } from "./_env.mjs";
import pg from "pg";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const env = loadEnv();
const archivo = process.argv[2];
const CONFIRMAR = process.argv.includes("--confirmar");
if (!archivo) { console.error("Uso: node scripts/restaurar_db.mjs <archivo.json.gz> [--confirmar]"); process.exit(1); }

const dump = JSON.parse(gunzipSync(readFileSync(archivo)).toString());
const tablas = Object.keys(dump.datos);
console.log(`Respaldo: ${archivo}`);
console.log(`  creado: ${dump.meta?.creado_en ?? "?"}`);
for (const t of tablas) console.log(`     ${t.padEnd(20)} ${dump.datos[t].length} filas`);

// node-pg convierte objetos JS a literal de array de Postgres; para columnas jsonb necesitamos
// JSON. Tras el round-trip por JSON, los valores de jsonb son objetos/arrays y las fechas son
// strings ISO. Regla segura para ESTE esquema (sin columnas array nativas): cualquier valor que
// sea objeto/array no nulo se serializa a JSON antes de enviarlo.
const bind = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);

const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });
const c = await pool.connect();
try {
  // Orden FK-seguro (padres antes que hijos), calculado de la base actual.
  const { rows: fks } = await c.query(`
    select tc.table_name child, ccu.table_name parent
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
    where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public' and tc.table_name<>ccu.table_name
    group by 1,2`);
  const deps = new Map(tablas.map((t) => [t, new Set()]));
  for (const { child, parent } of fks) if (deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  const orden = [], visto = new Set();
  const visita = (t, pila = new Set()) => {
    if (visto.has(t) || pila.has(t)) return;
    pila.add(t);
    for (const p of deps.get(t) ?? []) visita(p, pila);
    visto.add(t); orden.push(t);
  };
  for (const t of tablas) visita(t);

  if (!CONFIRMAR) {
    console.log("\n🧪 ENSAYO: no se escribió nada. Orden de inserción FK-seguro:");
    console.log("   " + orden.join(" → "));
    console.log("\n   Para restaurar DE VERDAD (borra y recarga): agrega --confirmar");
    process.exit(0);
  }

  console.log("\n⚠️  RESTAURANDO (borrando y recargando)…");
  await c.query("begin");
  // Vaciar todo de un golpe (CASCADE + RESTART IDENTITY) y recargar.
  await c.query(`truncate ${tablas.map((t) => `"${t}"`).join(", ")} restart identity cascade`);

  let totalFilas = 0;
  for (const t of orden) {
    const filas = dump.datos[t];
    if (!filas?.length) continue;
    const cols = Object.keys(filas[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    // Inserta en lotes para no armar consultas gigantes.
    const LOTE = 500;
    for (let i = 0; i < filas.length; i += LOTE) {
      const trozo = filas.slice(i, i + LOTE);
      const params = [];
      const valores = trozo.map((fila) => {
        const ph = cols.map((col) => { params.push(bind(fila[col])); return `$${params.length}`; });
        return `(${ph.join(", ")})`;
      });
      await c.query(`insert into "${t}" (${colList}) values ${valores.join(", ")}`, params);
    }
    totalFilas += filas.length;
  }

  // Resetea cada secuencia a max(id) para que los próximos inserts no choquen.
  const { rows: seqs } = await c.query(`
    select s.relname seq, t.relname tabla, a.attname col
    from pg_class s
    join pg_depend d on d.objid=s.oid and d.deptype='a'
    join pg_class t on t.oid=d.refobjid
    join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid
    where s.relkind='S' and t.relnamespace='public'::regnamespace`);
  for (const { seq, tabla, col } of seqs) {
    await c.query(
      `select setval('"${seq}"', coalesce((select max("${col}") from "${tabla}"), 1),
              (select count(*)>0 from "${tabla}"))`);
  }

  await c.query("commit");
  console.log(`✅ Restaurado: ${totalFilas} filas en ${orden.length} tablas. Secuencias reseteadas.`);
} catch (e) {
  try { await c.query("rollback"); } catch {}
  console.error("❌ Falló la restauración (ROLLBACK, base intacta):", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
