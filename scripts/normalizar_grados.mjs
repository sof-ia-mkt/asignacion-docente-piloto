// Normaliza licenciatura / maestria / doctorado en profesores:
//   1) "NA" (y similares) -> vacío (NULL)
//   2) Tipo Título parejo (conectores en minúscula, siglas en mayúscula)
//   3) Diccionario curado de correcciones (ortografía + acentos)
//
//   node scripts/normalizar_grados.mjs            -> VISTA PREVIA (no guarda); imprime antes->después
//   node scripts/normalizar_grados.mjs --aplicar  -> aplica de verdad (UPDATE)
import { loadEnv } from "./_env.mjs";
import pg from "pg";

const APLICAR = process.argv.includes("--aplicar");
const env = loadEnv();

// quita acentos y baja a minúscula, para usar como llave
const key = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Conectores que van en minúscula (salvo si son la primera palabra)
const CONECTORES = new Set(["de", "del", "en", "la", "las", "los", "el", "y", "e", "a", "con", "para", "por", "o", "u"]);

// Siglas / nombres propios que van en mayúscula tal cual
const SIGLAS = new Map([["mba", "MBA"], ["tic", "TIC"], ["utel", "UTEL"], ["na", "NA"]]);

// Diccionario curado: llave SIN acento y en minúscula -> forma correcta (con acento/ortografía)
const CORR = new Map(Object.entries({
  // raíces de ingeniería mal escritas
  ingeneria: "Ingeniería", ingenerio: "Ingeniería", ingeniaria: "Ingeniería",
  ingneria: "Ingeniería", ingienieria: "Ingeniería", ingenieria: "Ingeniería",
  ingeniero: "Ingeniero",
  // administración / negocios
  admnistracion: "Administración", administracion: "Administración",
  nehocios: "Negocios", negocios: "Negocios",
  internacioanles: "Internacionales", internacionales: "Internacionales",
  internacioanl: "Internacional",
  // varios típicos
  gastronimia: "Gastronomía", gastronomia: "Gastronomía",
  ciivil: "Civil", licencitura: "Licenciatura",
  cienas: "Ciencias", ciencias: "Ciencias",
  punlicas: "Públicas", publicas: "Públicas", publica: "Pública", punlica: "Pública",
  justica: "Justicia",
  // acentos en palabras comunes
  psicologia: "Psicología", quimica: "Química", quimico: "Químico",
  contaduria: "Contaduría", criminologia: "Criminología", criminalistica: "Criminalística",
  matematicas: "Matemáticas", matematica: "Matemática",
  educacion: "Educación", comunicacion: "Comunicación", informatica: "Informática",
  electronica: "Electrónica", electronico: "Electrónico",
  electromecanica: "Electromecánica", electromecanico: "Electromecánico",
  mecatronica: "Mecatrónica", mecanica: "Mecánica", mecanico: "Mecánico",
  electrica: "Eléctrica", electrico: "Eléctrico",
  aeronautica: "Aeronáutica", aeroespacial: "Aeroespacial",
  biotecnica: "Biotécnica", geodesica: "Geodésica", logistica: "Logística",
  tecnologias: "Tecnologías", tecnologia: "Tecnología", tecnico: "Técnico",
  energias: "Energías", energia: "Energía",
  gestion: "Gestión", produccion: "Producción", innovacion: "Innovación",
  filosofia: "Filosofía", biologia: "Biología", odontologo: "Odontólogo",
  bioingenieria: "Bioingeniería", bioquimica: "Bioquímica", sexologia: "Sexología",
  enfasis: "énfasis", reconstruccion: "Reconstrucción",
  automatizacion: "Automatización", robotica: "Robótica",
  precision: "Precisión", computacion: "Computación", computacionales: "Computacionales",
  maquinados: "Maquinados", area: "Área", politicas: "Políticas", politica: "Política",
  // grados / palabras sueltas con acento faltante
  maestria: "Maestría", direccion: "Dirección", nutricion: "Nutrición",
  asesoria: "Asesoría", psicopedagogica: "Psicopedagógica", orientacion: "Orientación",
  biotecnologia: "Biotecnología", organizacion: "Organización",
}));

// Convierte una palabra a su forma normalizada, conservando puntuación
// que la rodea (paréntesis, comas, puntos): "(MBA)" -> "(MBA)", "LIC." -> "Lic."
function palabra(tok, esPrimera) {
  if (!tok) return tok;
  const pre = (tok.match(/^\P{L}+/u)?.[0]) ?? "";
  const post = (tok.match(/\P{L}+$/u)?.[0]) ?? "";
  const core = tok.slice(pre.length, tok.length - post.length);
  if (!core) return tok; // token sin letras (p. ej. "/")
  const k = key(core);
  if (SIGLAS.has(k)) return pre + SIGLAS.get(k) + post;
  if (CORR.has(k)) return pre + CORR.get(k) + post;
  if (CONECTORES.has(k) && !esPrimera) return pre + k + post;
  // Tipo Título por defecto
  return pre + core.charAt(0).toUpperCase() + core.slice(1).toLowerCase() + post;
}

function normalizaParte(parte) {
  const toks = parte.trim().split(/\s+/);
  return toks.map((t, i) => palabra(t, i === 0)).join(" ");
}

export function normaliza(valor) {
  if (valor == null) return null;
  const t = valor.toString().replace(/\s+/g, " ").trim();
  if (t === "") return null;
  // placeholders de "no tiene"
  if (["na", "n/a", "ninguna", "ninguno", "no aplica", "-"].includes(key(t))) return null;
  // respeta separador de varios grados " / "
  return t.split("/").map((p) => normalizaParte(p)).join(" / ").replace(/\s+\/\s+/g, " / ");
}

// ---- ejecución ----
const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(
    "select id, nombre, licenciatura, maestria, doctorado from profesores order by nombre");

  const cambios = { licenciatura: [], maestria: [], doctorado: [] };
  let aNull = 0;
  for (const p of rows) {
    const upd = {};
    for (const campo of ["licenciatura", "maestria", "doctorado"]) {
      const antes = p[campo];
      if (antes == null || antes === "") continue;
      const desp = normaliza(antes);
      if (desp !== antes) {
        upd[campo] = desp;
        cambios[campo].push({ antes, desp });
        if (desp === null) aNull++;
      }
    }
    if (Object.keys(upd).length) {
      await client.query(
        `update profesores set
           licenciatura = case when $2 then $3 else licenciatura end,
           maestria     = case when $4 then $5 else maestria end,
           doctorado    = case when $6 then $7 else doctorado end
         where id = $1`,
        [p.id,
         "licenciatura" in upd, upd.licenciatura ?? null,
         "maestria" in upd, upd.maestria ?? null,
         "doctorado" in upd, upd.doctorado ?? null]);
    }
  }

  // Reporte de distintos antes->después por campo
  for (const campo of ["licenciatura", "maestria", "doctorado"]) {
    const vistos = new Set();
    const distintos = [];
    for (const c of cambios[campo]) {
      const k = c.antes + "→" + c.desp;
      if (!vistos.has(k)) { vistos.add(k); distintos.push(c); }
    }
    console.log(`\n======== ${campo.toUpperCase()} — ${distintos.length} valores cambian ========`);
    for (const c of distintos) {
      console.log(`  ${JSON.stringify(c.antes)}\n      → ${c.desp === null ? "(vacío)" : JSON.stringify(c.desp)}`);
    }
  }
  console.log(`\n"NA"/placeholder vaciados: ${aNull}`);

  if (APLICAR) { await client.query("COMMIT"); console.log("\n✅ COMMIT: cambios guardados."); }
  else { await client.query("ROLLBACK"); console.log("\n🧪 VISTA PREVIA: ROLLBACK, nada se guardó. Usa --aplicar para guardar."); }
} catch (e) {
  await client.query("ROLLBACK");
  console.error("ROLLBACK por error:", e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
