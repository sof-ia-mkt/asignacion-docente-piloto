// Reconcilia profesores.coordinador con el padrón (usuarios.nombre).
//
// El campo `coordinador` debe ser SIEMPRE el nombre canónico de un usuario activo
// (es lo que ya imponen los formularios de alta/edición). Datos viejos quedaron con
// nombres cortos (ej. "Daniel" en vez de "Daniel Luna"), lo que fragmentaba el filtro.
//
// Para cada valor de coordinador que NO exista tal cual en el padrón, busca el usuario
// activo cuyo nombre sea el canónico (igualdad sin acentos/caso, o el padrón empieza con
// el valor guardado: "Daniel" -> "Daniel Luna"). Si hay exactamente UNA coincidencia, la
// aplica; si hay 0 o varias, lo reporta para revisión manual (no adivina).
//
//   node scripts/normalizar_coordinadores.mjs            -> VISTA PREVIA (no guarda)
//   node scripts/normalizar_coordinadores.mjs --aplicar  -> aplica de verdad (UPDATE)
import { loadEnv } from "./_env.mjs";
import pg from "pg";

const APLICAR = process.argv.includes("--aplicar");
const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });
const q = (s, p) => pool.query(s, p).then((r) => r.rows);

const key = (s) => (s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const padron = await q(`select nombre from usuarios where activo = true`);
const padronKeys = new Map(padron.map((u) => [key(u.nombre), u.nombre]));

const valores = await q(
  `select coordinador, count(*)::int n from profesores
    where coordinador is not null and coordinador <> '' group by coordinador order by coordinador`);

const cambios = [];
const sinResolver = [];

for (const { coordinador, n } of valores) {
  const k = key(coordinador);
  if (padronKeys.has(k)) continue; // ya es canónico

  // Candidatos: el padrón cuyo nombre empieza con el valor guardado (token inicial).
  const candidatos = padron.filter(
    (u) => key(u.nombre) === k || key(u.nombre).startsWith(k + " "));
  if (candidatos.length === 1) {
    cambios.push({ de: coordinador, a: candidatos[0].nombre, n });
  } else {
    sinResolver.push({ coordinador, n, candidatos: candidatos.map((c) => c.nombre) });
  }
}

console.log(`Valores distintos de coordinador: ${valores.length}`);
if (cambios.length === 0 && sinResolver.length === 0) {
  console.log("Todo está alineado con el padrón. Nada que hacer.");
} else {
  for (const c of cambios) console.log(`  "${c.de}" -> "${c.a}"  (${c.n} docente${c.n === 1 ? "" : "s"})`);
  for (const s of sinResolver)
    console.log(`  ⚠️ "${s.coordinador}" (${s.n}) sin coincidencia única: [${s.candidatos.join(", ") || "ninguna"}] — revisar a mano`);
}

if (APLICAR && cambios.length) {
  for (const c of cambios) {
    await q(`update profesores set coordinador = $1 where coordinador = $2`, [c.a, c.de]);
  }
  console.log(`\nAplicado: ${cambios.length} valor(es) normalizado(s).`);
} else if (cambios.length) {
  console.log("\nVista previa. Corre con --aplicar para guardar.");
}

await pool.end();
