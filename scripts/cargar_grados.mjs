// Carga Perfil/Licenciatura, Maestría y Doctorado desde la pestaña "Docentes" del Excel
// fuente hacia la tabla profesores. "El Excel manda": donde el Excel trae dato, sobrescribe;
// donde el Excel está vacío, NO borra lo existente.
//
//   node scripts/cargar_grados.mjs           -> ENSAYO (BEGIN ... ROLLBACK), no guarda
//   node scripts/cargar_grados.mjs --aplicar -> aplica de verdad (COMMIT)
import { loadEnv } from "./_env.mjs";
import pg from "pg";
import { execSync } from "node:child_process";

const APLICAR = process.argv.includes("--aplicar");
const env = loadEnv();
const XLSX = "/Users/eme/Downloads/PROYECCIÓN MAYO - AGOSTO -ACTUALIZADA.xlsx";

const py = `
import openpyxl, json
wb = openpyxl.load_workbook(r'${XLSX}', read_only=True, data_only=True)
ws = wb['Docentes']
out=[]
for r in ws.iter_rows(min_row=2, values_only=True):
    if r[0] is None: continue
    out.append({'nombre':str(r[0]), 'lic':r[1], 'mae':r[2], 'doc':r[3]})
print(json.dumps(out, ensure_ascii=False))
`;
const data = JSON.parse(execSync(`python3 -c "${py.replace(/"/g, '\\"')}"`).toString());

const norm = (s) => (s ?? "").toString().toUpperCase().replace(/\s+/g, " ").trim()
  .normalize("NFD").replace(/[̀-ͯ]/g, "");

// Correcciones de nombre conocidas (base -> como viene en el Excel) para casos de tipeo.
const ALIAS = new Map([
  ["BURGOZ MERAZ CARLOS", "BURGOS MERAZ CARLOS"],
]);
const claveBusqueda = (nombre) => {
  const n = norm(nombre);
  return ALIAS.has(n) ? norm(ALIAS.get(n)) : n;
};

const limpia = (s) => {
  if (s == null) return null;
  const t = s.toString().replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

// Mapa nombre normalizado -> grados (si hay duplicados en el Excel, el último con dato gana)
const mapXlsx = new Map();
for (const d of data) {
  const k = norm(d.nombre);
  const prev = mapXlsx.get(k) ?? { lic: null, mae: null, doc: null };
  mapXlsx.set(k, {
    lic: limpia(d.lic) ?? prev.lic,
    mae: limpia(d.mae) ?? prev.mae,
    doc: limpia(d.doc) ?? prev.doc,
  });
}

const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows: profs } = await client.query("select id, nombre, licenciatura, maestria, doctorado from profesores");

  let nLic = 0, nMae = 0, nDoc = 0, tocados = 0, sinMatch = 0;
  for (const p of profs) {
    const g = mapXlsx.get(claveBusqueda(p.nombre));
    if (!g) { sinMatch++; continue; }
    const setLic = g.lic && g.lic !== (p.licenciatura ?? "");
    const setMae = g.mae && g.mae !== (p.maestria ?? "");
    const setDoc = g.doc && g.doc !== (p.doctorado ?? "");
    if (!setLic && !setMae && !setDoc) continue;
    await client.query(
      `update profesores set
         licenciatura = coalesce($2, licenciatura),
         maestria     = coalesce($3, maestria),
         doctorado    = coalesce($4, doctorado)
       where id = $1`,
      [p.id, setLic ? g.lic : null, setMae ? g.mae : null, setDoc ? g.doc : null]
    );
    if (setLic) nLic++;
    if (setMae) nMae++;
    if (setDoc) nDoc++;
    tocados++;
  }

  console.log(`Docentes en DB: ${profs.length}`);
  console.log(`  actualizados: ${tocados}  (sin match en Excel: ${sinMatch})`);
  console.log(`  licenciatura escritas: ${nLic} | maestría: ${nMae} | doctorado: ${nDoc}`);

  // Estado final (dentro de la transacción)
  const { rows: fin } = await client.query(`
    select count(*) filter (where licenciatura is not null and licenciatura<>'')::int lic,
           count(*) filter (where maestria is not null and maestria<>'')::int mae,
           count(*) filter (where doctorado is not null and doctorado<>'')::int doc
    from profesores`);
  console.log(`  -> tras la carga: con lic ${fin[0].lic}, con maestría ${fin[0].mae}, con doctorado ${fin[0].doc}`);

  if (APLICAR) { await client.query("COMMIT"); console.log("\n✅ COMMIT: cambios guardados."); }
  else { await client.query("ROLLBACK"); console.log("\n🧪 ENSAYO: ROLLBACK, nada se guardó. Usa --aplicar para guardar."); }
} catch (e) {
  await client.query("ROLLBACK");
  console.error("ROLLBACK por error:", e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
