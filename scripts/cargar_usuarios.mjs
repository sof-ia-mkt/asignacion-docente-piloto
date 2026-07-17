// Siembra inicial del padrón de usuarios en la base (tabla `usuarios`, migración 0012).
// Cifra la contraseña temporal con el MISMO scrypt que src/lib/password.ts.
// Idempotente: si el usuario ya existe, NO lo toca (no resetea contraseñas ya cambiadas).
// Uso: node scripts/cargar_usuarios.mjs
//
// SEGURIDAD: la temporal es ALEATORIA y DISTINTA por usuario (misma regla que el alta por
// UI, generarPasswordTemporal). Antes era una constante compartida commiteada en el repo:
// cualquiera con acceso al código podía entrar a las cuentas que no la hubieran cambiado.
// Cada temporal se imprime UNA vez aquí; anótala y compártela por un canal seguro.
import { scryptSync, randomBytes, randomInt } from "node:crypto";
import pg from "pg";
import { loadEnv } from "./_env.mjs";

// Alfabeto sin caracteres confundibles (0/O, 1/l/I), igual que usuarios-db.ts.
const ABC_TEMPORAL = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
function passwordTemporal() {
  let s = "";
  for (let i = 0; i < 10; i++) s += ABC_TEMPORAL[randomInt(ABC_TEMPORAL.length)];
  return `T-${s}`;
}

function cifrar(plano) {
  const salt = randomBytes(16);
  const hash = scryptSync(plano, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

// usuario, nombre, correo, rol, carrera, es_admin
const USUARIOS = [
  ["amisadahi.ramirez", "Amisadahi Ramírez", "coordinacion.academica.general@cenyca.edu.mx", "academica", null, false],
  ["daniel.luna",       "Daniel Luna",       "coordinacion.academica.general@cenyca.edu.mx", "academica", null, true],
  ["estefany.garcia",   "Estefany García",   "coordinacion.academica.general@cenyca.edu.mx", "academica", null, false],
  ["fernanda.chavez",   "Fernanda Chávez",   "coordinacion.academica.general@cenyca.edu.mx", "academica", null, false],
  ["rigoberto.lozoya",  "Rigoberto Lozoya",  "coordinacion.cyc@cenyca.edu.mx", "carrera", "Criminología, Criminalística y Derecho", false],
  ["luis.alfonso",      "Luis Alfonso",      "coordinacion.ingenierias@cenyca.edu.mx", "carrera", "Ingenierías (todas)", false],
  ["brandon.rodriguez", "Brandon Rodríguez", "coord.gastronomia@cenyca.edu.mx", "carrera", "Gastronomía", false],
  ["sergio.mancilla",   "Sergio Mancilla",   "sergio.mancilla@cenyca.edu.mx", null, null, true],
];

const client = new pg.Client({ connectionString: loadEnv().SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await client.connect();

let nuevos = 0;
for (const [usuario, nombre, correo, rol, carrera, esAdmin] of USUARIOS) {
  const temporal = passwordTemporal();
  const res = await client.query(
    `insert into usuarios (usuario, nombre, correo, rol, carrera, es_admin, password_hash, debe_cambiar_password)
     values ($1,$2,$3,$4,$5,$6,$7,true)
     on conflict (usuario) do nothing
     returning usuario`,
    [usuario, nombre, correo, rol, carrera, esAdmin, cifrar(temporal)],
  );
  if (res.rowCount) { nuevos++; console.log(`+ ${usuario}${esAdmin ? " (admin)" : ""} · temporal: ${temporal}`); }
  else console.log(`= ${usuario} (ya existía, sin cambios)`);
}

const { rows } = await client.query("select count(*)::int n from usuarios");
console.log(`\nNuevos: ${nuevos}. Total en padrón: ${rows[0].n}.`);
if (nuevos) console.log("Anota las temporales de arriba: no se guardan en claro y no se pueden recuperar.");
await client.end();
