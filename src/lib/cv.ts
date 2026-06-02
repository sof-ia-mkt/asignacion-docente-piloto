// Lee un CV (PDF) con Claude y deduce qué materias del catálogo puede impartir.
// Reusa el mismo prompt/herramienta/puntajes que scripts/ingest_cvs.mjs.
// SOLO servidor. Cada llamada cuesta ~$0.05 — invocar una vez por alta, nunca en bucle.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { q } from "./db";

const MODEL = "claude-sonnet-4-6";
export const PUNTAJE_CV = { alta: 25, media: 15, baja: 8 } as const;

export const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

// La API key suele estar sombreada (vacía) en process.env; si falta, se lee de .env.local.
function apiKey(): string {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  if (fromEnv) return fromEnv;
  const txt = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of txt.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i !== -1 && t.slice(0, i).trim() === "ANTHROPIC_API_KEY") return t.slice(i + 1).trim();
  }
  throw new Error("Falta ANTHROPIC_API_KEY (.env.local)");
}

export type MateriaSugerida = { materia: string; confianza: "alta" | "media" | "baja"; motivo: string };
export type PerfilCV = {
  area_principal: string;
  licenciatura: string;
  maestria?: string | null;
  anios_experiencia: number;
  materias_que_puede_impartir: MateriaSugerida[];
};

const TOOL = {
  name: "registrar_perfil_docente",
  description: "Registra el perfil profesional extraído del CV y las materias del catálogo que el docente puede impartir.",
  input_schema: {
    type: "object" as const,
    properties: {
      area_principal: { type: "string", description: "Área principal de especialización." },
      licenciatura: { type: "string" },
      maestria: { type: ["string", "null"] },
      anios_experiencia: { type: "integer" },
      materias_que_puede_impartir: {
        type: "array",
        description: "Materias TOMADAS TEXTUALMENTE del catálogo que este docente podría impartir.",
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

// Procesa el PDF y devuelve el perfil + las candidaturas mapeadas a IDs reales del catálogo.
export async function leerCV(pdf: Buffer, nombre: string) {
  const materias = await q<{ id: number; nombre: string }>("select id, nombre from materias");
  const matByNorm = new Map(materias.map((m) => [norm(m.nombre), m.id]));
  const catalogoTxt = materias.map((m) => `- ${m.nombre}`).join("\n");

  const anthropic = new Anthropic({ apiKey: apiKey(), baseURL: "https://api.anthropic.com" });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [{
      type: "text",
      text: "Eres un asistente de coordinación académica. Analizas el CV de un docente y determinas qué materias del catálogo de la universidad podría impartir, con base en su formación académica y experiencia profesional/docente.\n\n" +
        "Reglas:\n" +
        "- Solo propon materias que aparezcan EXACTAMENTE en el catálogo de abajo (copia el nombre tal cual).\n" +
        "- Confianza 'alta' si su formación/experiencia es directamente del área de la materia; 'media' si es afín; 'baja' si es un estiramiento razonable.\n" +
        "- No inventes materias fuera del catálogo. Sé generoso pero realista.\n\n" +
        "CATÁLOGO DE MATERIAS (CASA BLANCA):\n" + catalogoTxt,
      cache_control: { type: "ephemeral" },
    }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: "registrar_perfil_docente" },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
        { type: "text", text: `Analiza el CV de ${nombre} y registra su perfil y las materias del catálogo que puede impartir.` },
      ],
    }],
  });

  const tu = msg.content.find((c) => c.type === "tool_use");
  if (!tu || tu.type !== "tool_use") throw new Error("Claude no devolvió un perfil estructurado.");
  const perfil = tu.input as PerfilCV;

  const candidaturas: { materia_id: number; puntaje: number; razon: string }[] = [];
  for (const item of perfil.materias_que_puede_impartir || []) {
    if (!item?.materia) continue;
    const mid = matByNorm.get(norm(item.materia));
    if (!mid) continue;
    candidaturas.push({
      materia_id: mid,
      puntaje: PUNTAJE_CV[item.confianza] ?? 8,
      razon: `CV (${item.confianza}): ${item.motivo}`,
    });
  }
  return { perfil, candidaturas, modelo: MODEL };
}
