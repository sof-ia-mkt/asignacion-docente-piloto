// Carga el catálogo de aulas y el cupo de alumnos por grupo desde casablanca.json.
// NO trunca nada: conserva slots y asignaciones existentes.
// Uso: node --env-file=.env.local scripts/cargar_aulas.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  readFileSync(join(__dirname, "..", "db", "seed_data", "casablanca.json"), "utf8"));

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await client.connect();

try {
  await client.query("begin");

  // ---- aulas (solo las que tienen tipo conocido) ----
  let nAulas = 0;
  for (const a of data.aulas) {
    if (!a.clave || !a.tipo) continue;
    await client.query(
      `insert into aulas (clave, tipo, capacidad) values ($1,$2,$3)
       on conflict (clave) do update set tipo = excluded.tipo, capacidad = excluded.capacidad`,
      [a.clave, a.tipo, a.capacidad ?? null]);
    nAulas++;
  }

  // ---- alumnos por grupo ----
  let nGrupos = 0;
  for (const [clave, alumnos] of Object.entries(data.alumnos_por_grupo)) {
    const res = await client.query(
      "update grupos set alumnos = $1 where clave = $2", [alumnos, clave]);
    nGrupos += res.rowCount;
  }

  await client.query("commit");

  const aulas = (await client.query("select count(*)::int n from aulas")).rows[0].n;
  const conAlumnos = (await client.query("select count(*)::int n from grupos where alumnos is not null")).rows[0].n;
  console.log(`Carga OK: aulas=${aulas} (insertadas/actualizadas ${nAulas}), grupos con alumnos=${conAlumnos} (actualizados ${nGrupos})`);
} catch (e) {
  await client.query("rollback");
  console.error("ERROR cargar_aulas:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
