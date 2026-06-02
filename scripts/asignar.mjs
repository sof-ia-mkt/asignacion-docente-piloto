// Motor de asignación (ciclo septiembre) + alertas. NO llama a la API: todo sale de la BD.
// Uso: node scripts/asignar.mjs
//
// Opción A (acordada): solo se consideran candidatos FUERTES
//   - historial (ya dio la materia en mayo, +40)
//   - CV con confianza "alta" (+25)
// Se ignoran CV "media" (15) y "baja" (8) para que las recomendaciones salgan certeras.
//
// Política: por cada slot de septiembre se asigna el candidato de mayor puntaje que
// NO choque de horario y no esté sobrecargado. Si el único candidato choca o se
// sobrecarga, se asigna igual (estado 'sugerida') y se levanta la alerta para que
// coordinación decida.
import pg from "pg";
import { loadEnv } from "./_env.mjs";

const env = loadEnv();
const SCORE_MIN = 25;          // umbral opción A (historial 40, cv-alta 25)
const SOBRECARGA_SLOTS = 12;   // > este número de slots (~24h/sem) => alerta de sobrecarga
// "Docentes" que en realidad son notas del Excel, no personas: no son asignables.
const PLACEHOLDERS = ["CAMBIO DE TURNO", "DOCENTE NUEVO", "NO SE APERTURA", "NOSE APERTURA"];

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();

const toMin = (h) => { if (!h) return null; const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const overlap = (a, b) =>
  a.dia && b.dia && a.dia === b.dia && a.ini != null && b.ini != null && a.ini < b.fin && b.ini < a.fin;

// ---- candidatos fuertes por materia (combina historial + cv-alta del mismo profe) ----
const cand = (await db.query(
  `select mc.materia_id, mc.profesor_id, sum(mc.puntaje)::int puntaje,
          string_agg(mc.razon, ' | ' order by mc.puntaje desc) razon
     from materia_candidatos mc
     join profesores p on p.id = mc.profesor_id
    where mc.puntaje >= $1 and p.nombre <> all($2)
    group by mc.materia_id, mc.profesor_id`, [SCORE_MIN, PLACEHOLDERS])).rows;
const porMateria = new Map();   // materia_id -> [{profesor_id, puntaje, razon}] desc
for (const c of cand) {
  if (!porMateria.has(c.materia_id)) porMateria.set(c.materia_id, []);
  porMateria.get(c.materia_id).push(c);
}
for (const arr of porMateria.values()) arr.sort((a, b) => b.puntaje - a.puntaje);

// ---- slots de septiembre ----
const slots = (await db.query(
  `select s.id, s.materia_id, s.grupo_id, s.dia, s.hora_inicio, s.hora_fin, s.tipo,
          m.nombre materia, g.clave grupo
     from slots s
     left join materias m on m.id = s.materia_id
     left join grupos g on g.id = s.grupo_id
    where s.es_historial = false`)).rows
  .map((s) => ({ ...s, ini: toMin(s.hora_inicio), fin: toMin(s.hora_fin) }));

// procesa primero los slots con mejor candidato (las coincidencias más fuertes reclaman docente antes)
const mejor = (s) => (porMateria.get(s.materia_id)?.[0]?.puntaje ?? -1);
slots.sort((a, b) => mejor(b) - mejor(a));

// ---- asignación ----
await db.query("begin");
await db.query("delete from alertas");
await db.query("delete from asignaciones");

const horario = new Map();      // profesor_id -> [{slot_id, dia, ini, fin}]
const carga = new Map();        // profesor_id -> nº slots
const asignados = [];           // {slot, profesor_id, puntaje, razon}
const alertas = [];
let sinCand = 0;

for (const s of slots) {
  const cands = porMateria.get(s.materia_id) || [];
  if (!cands.length) {
    sinCand++;
    asignados.push({ slot: s, profesor_id: null });
    alertas.push({
      tipo: "sin_candidato", severidad: "alta", slot_id: s.id, slot_id_2: null, profesor_id: null,
      detalle: `Sin candidato fuerte para "${s.materia}" (${s.grupo ?? "s/grupo"}).`,
    });
    continue;
  }

  // Restricción dura: el candidato debe estar LIBRE a esa hora (nadie en 2 lugares a la vez).
  const elegido = cands.find((c) => !(horario.get(c.profesor_id) || []).some((h) => overlap(h, s)));

  if (!elegido) {
    // Todos los candidatos fuertes ya están ocupados a esa hora -> choque sin resolver.
    const top = cands[0];
    const conf = (horario.get(top.profesor_id) || []).find((h) => overlap(h, s));
    const sc = slots.find((x) => x.id === conf.slot_id);
    asignados.push({ slot: s, profesor_id: null });
    alertas.push({
      tipo: "choque_horario", severidad: "alta", slot_id: s.id, slot_id_2: sc.id, profesor_id: top.profesor_id,
      detalle: `"${s.materia}" (${s.grupo}) ${s.dia} ${s.hora_inicio}-${s.hora_fin} sin docente: el candidato fuerte ya da "${sc.materia}" (${sc.grupo}) a esa hora.`,
    });
    continue;
  }

  if (!horario.has(elegido.profesor_id)) horario.set(elegido.profesor_id, []);
  horario.get(elegido.profesor_id).push({ slot_id: s.id, dia: s.dia, ini: s.ini, fin: s.fin });
  carga.set(elegido.profesor_id, (carga.get(elegido.profesor_id) || 0) + 1);
  asignados.push({ slot: s, profesor_id: elegido.profesor_id, puntaje: elegido.puntaje, razon: elegido.razon });
}

// inserta asignaciones
for (const a of asignados) {
  await db.query(
    `insert into asignaciones (slot_id, profesor_id, estado, puntaje, razon, automatica)
     values ($1,$2,$3,$4,$5,true)`,
    [a.slot.id, a.profesor_id, a.profesor_id ? "sugerida" : "rechazada",
     a.puntaje ?? null, a.razon ?? null]);
}

// sobrecarga: profe con demasiados slots
for (const [pid, n] of carga) {
  if (n > SOBRECARGA_SLOTS) alertas.push({
    tipo: "sobrecarga", severidad: n > SOBRECARGA_SLOTS * 1.5 ? "alta" : "media",
    slot_id: null, slot_id_2: null, profesor_id: pid,
    detalle: `Asignado a ${n} slots en septiembre (umbral ${SOBRECARGA_SLOTS}).`,
  });
}

// docente_repetido: mismo profe cubriendo la misma materia en muchos grupos (sobre-concentración)
const REPETIDO_GRUPOS = 6;
const porProfMat = new Map();
for (const a of asignados) {
  if (!a.profesor_id) continue;
  const k = `${a.profesor_id}|${a.slot.materia_id}`;
  if (!porProfMat.has(k)) porProfMat.set(k, { prof: a.profesor_id, materia: a.slot.materia, grupos: new Set(), slot: a.slot.id });
  porProfMat.get(k).grupos.add(a.slot.grupo_id);
}
for (const v of porProfMat.values()) {
  if (v.grupos.size >= REPETIDO_GRUPOS) alertas.push({
    tipo: "docente_repetido", severidad: "media", slot_id: v.slot, slot_id_2: null, profesor_id: v.prof,
    detalle: `Mismo docente cubre "${v.materia}" en ${v.grupos.size} grupos (posible sobre-concentración).`,
  });
}

for (const al of alertas) {
  await db.query(
    `insert into alertas (tipo, severidad, slot_id, slot_id_2, profesor_id, detalle)
     values ($1,$2,$3,$4,$5,$6)`,
    [al.tipo, al.severidad, al.slot_id, al.slot_id_2, al.profesor_id, al.detalle]);
}

await db.query("commit");

// ---- resumen ----
const asignadosN = asignados.filter((a) => a.profesor_id).length;
const porTipo = {};
for (const al of alertas) porTipo[al.tipo] = (porTipo[al.tipo] || 0) + 1;
console.log(`Slots septiembre:        ${slots.length}`);
console.log(`  asignados:             ${asignadosN}`);
console.log(`  sin candidato fuerte:  ${sinCand}`);
console.log(`Alertas: ${alertas.length}  ${JSON.stringify(porTipo)}`);
await db.end();
