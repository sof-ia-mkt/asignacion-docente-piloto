// Descarga del CV (PDF) de un docente desde el bucket privado "cvs".
// GET /profesores/<id>/cv  ->  302 a una URL firmada fresca (Supabase Storage).
// El bucket es privado: nunca exponemos un enlace permanente, solo uno temporal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

const BUCKET = "cvs";
const TTL = 60 * 5; // 5 min: el navegador sigue el redirect al instante.

// Las vars de entorno a veces vienen vacías en runtime; si faltan, se leen de .env.local.
function envVar(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  try {
    const txt = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i !== -1 && t.slice(0, i).trim() === name) return t.slice(i + 1).trim();
    }
  } catch {
    /* sin .env.local en producción: dependemos de process.env */
  }
  throw new Error(`Falta ${name}`);
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pid = Number(id);
  if (!Number.isInteger(pid)) return new Response("ID inválido", { status: 400 });

  const [prof] = await q<{ cv_path: string | null }>(
    `select cv_path from profesores where id = $1`, [pid]);
  if (!prof?.cv_path) return new Response("Este docente no tiene CV cargado.", { status: 404 });

  const sb = createClient(envVar("NEXT_PUBLIC_SUPABASE_URL"), envVar("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false },
  });
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(prof.cv_path, TTL);
  if (error || !data?.signedUrl) {
    return new Response(`No se pudo abrir el CV: ${error?.message ?? "sin URL"}`, { status: 502 });
  }
  return Response.redirect(data.signedUrl, 302);
}
