// Ingesta de CVs: Claude lee cada PDF y deduce qué materias del catálogo puede dar.
// Uso: node scripts/ingest_cvs.mjs   (lee .env.local directo)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "./_env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const MODEL = "claude-sonnet-4-6";
const PUNTAJE = { alta: 25, media: 15, baja: 8 };

const data = JSON.parse(readFileSync(join(__dirname, "..", "db", "seed_data", "casablanca.json"), "utf8"));
const CV_DIR = join(__dirname, "..", "docs", "cvs-demo");

const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com" });
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();

// catálogo de materias desde la BD
const materias = (await db.query("select id, nombre from materias")).rows;
const matByNorm = new Map(materias.map((m) => [norm(m.nombre), m.id]));
const catalogoTxt = materias.map((m) => `- ${m.nombre}`).join("\n");

const TOOL = {
  name: "registrar_perfil_docente",
  description: "Registra el perfil profesional extraído del CV y las materias del catálogo que el docente puede impartir.",
  input_schema: {
    type: "object",
    properties: {
      area_principal: { type: "string", description: "Área principal de especialización (ej. matemáticas, electrónica, criminología)." },
      licenciatura: { type: "string" },
      maestria: { type: ["string", "null"] },
      anios_experiencia: { type: "integer" },
      materias_que_puede_impartir: {
        type: "array",
        description: "Materias TOMADAS TEXTUALMENTE del catálogo proporcionado que este docente podría impartir según su formación y experiencia.",
        items: {
          type: "object",
          properties: {
            materia: { type: "string", description: "Nombre EXACTO como aparece en el catálogo." },
            confianza: { type: "string", enum: ["alta", "media", "baja"] },
            motivo: { type: "string", description: "Breve razón basada en el CV." },
          },
          required: ["materia", "confianza", "motivo"],
        },
      },
    },
    required: ["area_principal", "licenciatura", "anios_experiencia", "materias_que_puede_impartir"],
  },
};

const SYSTEM = [
  {
    type: "text",
    text: "Eres un asistente de coordinación académica. Analizas el CV de un docente y determinas qué materias del catálogo de la universidad podría impartir, con base en su formación académica y experiencia profesional/docente.\n\n" +
      "Reglas:\n" +
      "- Solo propon materias que aparezcan EXACTAMENTE en el catálogo de abajo (copia el nombre tal cual).\n" +
      "- Confianza 'alta' si su formación/experiencia es directamente del área de la materia; 'media' si es afín; 'baja' si es un estiramiento razonable.\n" +
      "- No inventes materias fuera del catálogo. Sé generoso pero realista: incluye también materias afines que no haya impartido aún.\n\n" +
      "CATÁLOGO DE MATERIAS (CASA BLANCA):\n" + catalogoTxt,
    cache_control: { type: "ephemeral" },
  },
];

async function procesar(doc) {
  const pdfPath = join(CV_DIR, `${doc.slug}.pdf`);
  const pdfB64 = readFileSync(pdfPath).toString("base64");
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "registrar_perfil_docente" },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } },
        { type: "text", text: `Analiza el CV de ${doc.nombre} y registra su perfil y las materias del catálogo que puede impartir.` },
      ],
    }],
  });
  if (msg.stop_reason === "max_tokens") console.log(`  ! ${doc.slug}: respuesta truncada (max_tokens) — subir límite`);
  const tu = msg.content.find((c) => c.type === "tool_use");
  return { perfil: tu.input, usage: msg.usage };
}

// Candados de costo: por defecto NO re-lee un CV ya procesado (cero llamadas a la API).
//   node scripts/ingest_cvs.mjs                 -> solo los que faltan
//   node scripts/ingest_cvs.mjs --force         -> re-lee TODOS
//   node scripts/ingest_cvs.mjs --solo=<slug>   -> re-lee uno
const FORCE = process.argv.includes("--force");
const SOLO = (process.argv.find((a) => a.startsWith("--solo=")) || "").split("=")[1] || null;

let totalCand = 0;
for (const doc of data.docentes_piloto) {
  if (SOLO && doc.slug !== SOLO) continue;
  const pid = (await db.query("select id from profesores where slug=$1", [doc.slug])).rows[0]?.id;
  if (!pid) { console.log(`  ! sin profesor para ${doc.slug}`); continue; }

  if (!FORCE && !SOLO) {
    const ya = (await db.query("select 1 from cv_competencias where profesor_id=$1", [pid])).rows.length;
    if (ya) { console.log(`  · ${doc.nombre.slice(0, 32).padEnd(33)} ya procesado (skip, $0)`); continue; }
  }

  const { perfil, usage } = await procesar(doc);
  await db.query(
    `insert into cv_competencias (profesor_id, payload, modelo) values ($1,$2,$3)
     on conflict (profesor_id) do update set payload=excluded.payload, modelo=excluded.modelo, creado_en=now()`,
    [pid, perfil, MODEL]);

  // candidatos por CV (no pisar los de historial)
  await db.query("delete from materia_candidatos where profesor_id=$1 and fuente='cv'", [pid]);
  let n = 0;
  for (const item of perfil.materias_que_puede_impartir || []) {
    if (!item?.materia) continue;
    const mid = matByNorm.get(norm(item.materia));
    if (!mid) continue;
    await db.query(
      `insert into materia_candidatos (profesor_id, materia_id, fuente, puntaje, razon)
       values ($1,$2,'cv',$3,$4)
       on conflict (profesor_id, materia_id, fuente) do update set puntaje=excluded.puntaje, razon=excluded.razon`,
      [pid, mid, PUNTAJE[item.confianza] ?? 8, `CV (${item.confianza}): ${item.motivo}`]);
    n++;
  }
  totalCand += n;
  const cache = usage.cache_read_input_tokens ?? 0;
  console.log(`  ${doc.nombre.slice(0, 32).padEnd(33)} área=${(perfil.area_principal || "").slice(0, 14).padEnd(15)} materias=${n}  (cache_read=${cache})`);
}

console.log(`\nIngesta OK. Candidatos por CV insertados: ${totalCand}`);
await db.end();
