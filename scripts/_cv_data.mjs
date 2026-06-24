// Resolutor compartido (SOLO LECTURA de BD). No escribe nada.
// Une hoja_revision.csv (perfil + materias) con lista_cv.csv (PDF a subir)
// y decide la acción por profesor contra la BD viva (mapa por slug).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CV_DIR = join(homedir(), "cv_analisis");

export function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function clean(s) {
  return String(s || "").replace(/\(.*?\)/g, "").trim();
}

export function parseCSV(txt) {
  const rows = [];
  let i = 0, field = "", row = [], inQ = false;
  while (i < txt.length) {
    const c = txt[i];
    if (inQ) {
      if (c === '"') {
        if (txt[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadTable(path) {
  const rows = parseCSV(readFileSync(path, "utf8"));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, k) => [h, k]));
  const data = rows.slice(1).filter(r => r.some(c => c && c.trim()));
  return { idx, data, obj: data.map(r => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ""]))) };
}

// IDs vivos conocidos que NO matchean por slug (duplicados con nombre distinto en BD).
// Se resuelven por carpeta exacta -> id existente. Se tratan como UPDATE (no INSERT).
const DUP_FORZADO = {
  "FRANCISCO LOPEZ JORGE GUADALUPE": 25,      // slug exacto, ya existe
  "GARCÍA MARTELL UCIEL JANAI": 90,            // BD lo tiene como "JANAI UCIEL"
};

// profBySlug: Map(slug -> {id,nombre,slug}); matBySlug: Map(slug -> {id,nombre,slug})
export function buildPlan({ profBySlug, matBySlug }) {
  const hoja = loadTable(join(CV_DIR, "hoja_revision.csv"));
  const lista = loadTable(join(CV_DIR, "lista_cv.csv"));
  const cvByCarpeta = new Map(
    lista.obj.map(r => [r.carpeta.trim(), { estado: r.estado.trim(), archivo: r.archivo_cv.trim(), confianza: r.confianza.trim() }])
  );

  const plan = [];
  for (const r of hoja.obj) {
    const carpeta = r.carpeta.trim();
    const estado = (r.estado_recon || "").trim().toUpperCase();
    const cv = cvByCarpeta.get(carpeta) || null;

    // Resolver identidad por slug (match_padron preferido, luego carpeta)
    let id = null, dbNombre = null, via = null;
    if (DUP_FORZADO[carpeta] != null) { id = DUP_FORZADO[carpeta]; via = "dup_forzado"; }
    if (id == null) {
      for (const cand of [clean(r.match_padron), clean(carpeta)]) {
        if (!cand) continue;
        const hit = profBySlug.get(slugify(cand));
        if (hit) { id = hit.id; dbNombre = hit.nombre; via = "slug"; break; }
      }
    }
    if (id != null && dbNombre == null) {
      for (const p of profBySlug.values()) if (p.id === id) { dbNombre = p.nombre; break; }
    }

    // Acción
    let accion;
    if (estado === "REVISAR") accion = "OMITIR_REVISAR";
    else if (!cv || cv.estado !== "OK") accion = "OMITIR_SIN_CV";
    else if (estado === "DUPLICADO") accion = id ? "UPDATE" : "OMITIR_DUP_SIN_ID";
    else if (estado === "EXISTE" || estado === "DUDOSO") accion = id ? "UPDATE" : "ERROR_EXISTE_SIN_ID";
    else if (estado === "NUEVO") accion = id ? "UPDATE" /*dup forzado*/ : "INSERT";
    else accion = "ERROR_ESTADO";

    // Ruta del PDF en disco
    let pdfPath = null, pdfExiste = false;
    if (cv && cv.estado === "OK" && cv.archivo) {
      pdfPath = join(CV_DIR, "expedientes", carpeta, cv.archivo);
      pdfExiste = existsSync(pdfPath);
    }

    // Materias: exactas (match catálogo) vs crudas (todas)
    const crudas = [];
    const exactas = [];
    for (let s of (r.materias_que_puede_dar || "").split(";")) {
      s = s.trim(); if (!s) continue;
      crudas.push(s);
      const base = clean(s);
      const hit = base && matBySlug.get(slugify(base));
      if (hit) exactas.push({ texto: s, materia_id: hit.id, materia: hit.nombre });
    }

    plan.push({
      carpeta, estado, accion, id, dbNombre, via,
      perfil: {
        nombre: clean(r.match_padron) || carpeta,
        licenciatura: r.licenciatura || null,
        maestria: r.maestria || null,
        doctorado: r.doctorado || null,
        area_cv: r.area_cv || null,
        anios_experiencia: parseAnios(r.anios_experiencia),
        correo: (r.correo || "").trim() || null,
      },
      cv: cv ? { archivo: cv.archivo, confianza: cv.confianza, pdfPath, pdfExiste } : null,
      materias: { crudas, exactas },
    });
  }
  return { plan, hoja, lista };
}

function parseAnios(v) {
  const m = String(v || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}
