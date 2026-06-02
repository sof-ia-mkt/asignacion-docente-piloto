// Fusiona materias duplicadas (typos/acentos) detectadas en la auditoría.
// Para cada grupo: mueve slots + candidaturas a la materia "correcta" y borra la repetida.
// TODO en una transacción: o se hace completo, o no se hace nada.
// Uso: node scripts/fusionar_materias.mjs            (modo prueba, NO escribe)
//      node scripts/fusionar_materias.mjs --aplicar  (escribe de verdad)
import pg from "pg";
import { loadEnv } from "./_env.mjs";

const APLICAR = process.argv.includes("--aplicar");
const db = new pg.Client({ connectionString: loadEnv().SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();

// keep = id que se queda (la forma correcta). absorb = ids que se fusionan en keep.
// nombre = (opcional) renombrar el "keep" a la forma correcta cuando AMBAS estaban mal.
const GRUPOS = [
  { keep: 371, absorb: [77] },                          // Electrónica Analógica  (77 = "ELETRÓNICA")
  { keep: 110, absorb: [329] },                         // Ingeniería Eléctrica
  { keep: 44,  absorb: [290] },                          // Delincuencia Cibernética
  { keep: 63,  absorb: [61] },                           // Desarrollo Humano
  { keep: 27,  absorb: [372] },                          // Comunicación Escrita
  { keep: 405, absorb: [124] },                          // Juicios Orales
  { keep: 136, absorb: [392] },                          // Máquinas Térmicas
  { keep: 67,  absorb: [340] },                          // Dirección Empresarial
  { keep: 12,  absorb: [259] },                          // Administración Estratégica
  { keep: 227, absorb: [14] },                           // Administración PYME
  { keep: 169, absorb: [305] },                          // Reingeniería de Procesos
  { keep: 93,  absorb: [333] },                          // Fuentes de Financiamiento
  { keep: 354, absorb: [414] },                          // Desarrollo de Proyectos
  { keep: 355, absorb: [413], nombre: "DESARROLLO PSICOLÓGICO EN LA ADULTEZ" }, // ambas mal escritas
  { keep: 66,  absorb: [286], nombre: "DINÁMICA DE FLUIDOS" },                  // quita acento de FLUÍDOS
  { keep: 69,  absorb: [282] },                          // Diseño de Sitios Web
  { keep: 190, absorb: [328] },                          // Tecnología y Manejo de Materiales
  { keep: 107, absorb: [322] },                          // Inferencia Estadística en la Industria
  { keep: 161, absorb: [249] },                          // Proyectos de Investigación II
  { keep: 38,  absorb: [285, 296] },                     // Cálculo Aplicado a la Ingeniería I
  { keep: 39,  absorb: [299] },                          // Cálculo Aplicado a la Ingeniería II
  { keep: 134, absorb: [381] },                          // Modelación Matemática Aplicada a la Ing. I
  { keep: 135, absorb: [321] },                          // Modelación Matemática Aplicada a la Ing. II
  { keep: 176, absorb: [407] },                          // Seminario de Derecho Administrativo y Fiscal
  { keep: 174, absorb: [350] },                          // Seguridad Industrial e Higiene
  { keep: 5,   absorb: [394, 331] },                     // Administración de la Cadena de Suministro
];

const nombreDe = async (id) => (await db.query("select nombre from materias where id=$1", [id])).rows[0]?.nombre;

console.log(`\n=== FUSIÓN DE MATERIAS — modo ${APLICAR ? "APLICAR (escribe)" : "PRUEBA (no escribe)"} ===\n`);
const antes = (await db.query("select count(*)::int n from materias")).rows[0].n;

try {
  await db.query("begin");
  let movSlots = 0, movCand = 0, borradas = 0, renombradas = 0;

  for (const g of GRUPOS) {
    const nombreKeep = await nombreDe(g.keep);
    if (!nombreKeep) { console.log(`  ⚠️  keep id ${g.keep} no existe — salto este grupo`); continue; }

    for (const aid of g.absorb) {
      const nombreAbsorb = await nombreDe(aid);
      if (!nombreAbsorb) { console.log(`  ⚠️  absorb id ${aid} no existe — salto`); continue; }

      // 1) slots: apuntan a la materia correcta
      const s = await db.query("update slots set materia_id=$1 where materia_id=$2", [g.keep, aid]);
      // 2) candidaturas: primero borra las que chocarían con la llave única (profesor+materia+fuente)
      await db.query(
        `delete from materia_candidatos a
          where a.materia_id=$2
            and exists (select 1 from materia_candidatos b
                         where b.materia_id=$1 and b.profesor_id=a.profesor_id and b.fuente=a.fuente)`,
        [g.keep, aid]);
      const c = await db.query("update materia_candidatos set materia_id=$1 where materia_id=$2", [g.keep, aid]);
      // 3) borra la materia repetida
      await db.query("delete from materias where id=$1", [aid]);

      movSlots += s.rowCount; movCand += c.rowCount; borradas++;
      console.log(`  • "${nombreAbsorb}" (id ${aid}) → "${nombreKeep}" (id ${g.keep})   [${s.rowCount} slots, ${c.rowCount} candidaturas]`);
    }

    if (g.nombre && g.nombre !== nombreKeep) {
      await db.query("update materias set nombre=$1 where id=$2", [g.nombre, g.keep]);
      renombradas++;
      console.log(`     ↳ renombrada: "${nombreKeep}" → "${g.nombre}"`);
    }
  }

  const despues = (await db.query("select count(*)::int n from materias")).rows[0].n;
  console.log(`\n  Resumen: ${borradas} materias fusionadas · ${movSlots} slots reapuntados · ${movCand} candidaturas movidas · ${renombradas} renombradas`);
  console.log(`  Materias: ${antes} → ${despues}`);

  if (APLICAR) {
    await db.query("commit");
    console.log(`\n  ✅ Cambios GUARDADOS.\n`);
  } else {
    await db.query("rollback");
    console.log(`\n  🔍 PRUEBA: nada se guardó. Corre con --aplicar para escribir.\n`);
  }
} catch (e) {
  await db.query("rollback");
  console.error(`\n  ❌ Error, se revirtió todo:`, e.message, "\n");
  process.exitCode = 1;
} finally {
  await db.end();
}
