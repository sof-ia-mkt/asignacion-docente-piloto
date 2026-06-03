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
import { recomputarAlertas } from "../src/lib/alertas-core.mjs";

const env = loadEnv();
const SCORE_MIN = 25;          // umbral opción A (historial 40, cv-alta 25)
const PLANTEL_BONUS = 20;      // dio la materia EN ESTE plantel => +20 (se prefiere el fit local)
// (Los umbrales de sobrecarga, traslado, etc. viven en el módulo de alertas: ahí se diagnostica.)
// "Docentes" que en realidad son notas del Excel, no personas: no son asignables.
const PLACEHOLDERS = ["CAMBIO DE TURNO", "DOCENTE NUEVO", "NO SE APERTURA", "NOSE APERTURA"];

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
await db.connect();
// Adaptador para el módulo de alertas compartido: corre sobre ESTE cliente (misma transacción).
const query = async (sql, params = []) => (await db.query(sql, params)).rows;

const toMin = (h) => { if (!h) return null; const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const overlap = (a, b) =>
  a.dia && b.dia && a.dia === b.dia && a.ini != null && b.ini != null && a.ini < b.fin && b.ini < a.fin;

// ---- candidatos fuertes por materia (combina historial + cv-alta del mismo profe) ----
const cand = (await db.query(
  `select mc.materia_id, mc.profesor_id, max(p.nombre) nombre, sum(mc.puntaje)::int puntaje,
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
  `select s.id, s.materia_id, s.grupo_id, s.plantel, s.dia, s.hora_inicio, s.hora_fin, s.tipo, s.modalidad,
          s.aula_id, s.aula_manual, m.nombre materia, g.clave grupo, g.alumnos
     from slots s
     left join materias m on m.id = s.materia_id
     left join grupos g on g.id = s.grupo_id
    where s.es_historial = false`)).rows
  .map((s) => ({ ...s, ini: toMin(s.hora_inicio), fin: toMin(s.hora_fin) }));
const slotsById = new Map(slots.map((s) => [s.id, s]));

// ---- ¿en qué plantel(es) dio cada docente cada materia? (de su historial de mayo) ----
// Sirve para preferir el "fit local": quien ya la dio en ESTE plantel pesa más.
const histPlantel = new Map();   // `${profesor_id}|${materia_id}` -> Set<plantel>
for (const r of (await db.query(
  `select distinct docente_id, materia_id, plantel from slots
    where es_historial and docente_id is not null and materia_id is not null`)).rows) {
  const k = `${r.docente_id}|${r.materia_id}`;
  if (!histPlantel.has(k)) histPlantel.set(k, new Set());
  histPlantel.get(k).add(r.plantel);
}
const dioEnPlantel = (pid, mid, plantel) =>
  !!plantel && (histPlantel.get(`${pid}|${mid}`)?.has(plantel) ?? false);
const plantelesDe = (pid, mid) => [...(histPlantel.get(`${pid}|${mid}`) ?? [])];

// ---- catálogo de aulas (Teoría primero, luego por capacidad ascendente: el más chico que alcance) ----
const tipoRank = (t) => (t === "Teoría" ? 0 : t === "Práctica" ? 1 : 2);
const aulas = (await db.query(
  "select id, clave, tipo, capacidad from aulas where capacidad is not null")).rows
  .sort((a, b) => tipoRank(a.tipo) - tipoRank(b.tipo) || a.capacidad - b.capacidad);
const CAP_MAX = aulas.length ? Math.max(...aulas.map((a) => a.capacidad)) : 0;

// procesa primero los slots con mejor candidato (las coincidencias más fuertes reclaman docente antes)
const mejor = (s) => (porMateria.get(s.materia_id)?.[0]?.puntaje ?? -1);
slots.sort((a, b) => mejor(b) - mejor(a));

// ---- asignación ----
// Trabajo manual de coordinación (automatica=false): NO se toca. Solo se recalcula lo automático.
const manualRows = (await db.query(
  "select slot_id, profesor_id from asignaciones where automatica = false")).rows;
const manualSlotIds = new Set(manualRows.map((r) => r.slot_id));

await db.query("begin");
await db.query("delete from asignaciones where automatica = true");  // las alertas las reescribe recomputarAlertas al final

const horario = new Map();      // profesor_id -> [{slot_id, dia, ini, fin}]
const carga = new Map();        // profesor_id -> nº slots
const asignados = [];           // {slot, profesor_id, puntaje, razon} (solo los AUTOMÁTICOS, los que se insertan)
const manualAsignados = [];     // {slot, profesor_id} ya en BD; cuentan para carga/choque/repetido
let sinCand = 0;

// Siembra horario y carga con las asignaciones manuales para que el motor las respete:
// nadie se programa encima de un docente ya puesto a mano, y su carga ya cuenta.
for (const r of manualRows) {
  if (!r.profesor_id) continue;
  const s = slotsById.get(r.slot_id);
  if (!s) continue;
  if (!horario.has(r.profesor_id)) horario.set(r.profesor_id, []);
  horario.get(r.profesor_id).push({ slot_id: s.id, dia: s.dia, ini: s.ini, fin: s.fin });
  carga.set(r.profesor_id, (carga.get(r.profesor_id) || 0) + 1);
  manualAsignados.push({ slot: s, profesor_id: r.profesor_id });
}

for (const s of slots) {
  if (manualSlotIds.has(s.id)) continue;   // decisión humana: no la recalcula el motor
  const cands = porMateria.get(s.materia_id) || [];
  if (!cands.length) {
    sinCand++;
    asignados.push({ slot: s, profesor_id: null });
    continue;
  }

  // Puntaje efectivo PARA ESTE SLOT: +20 si el candidato ya dio la materia en este plantel.
  // Así, entre dos que la dieron, gana el local; el de otro plantel sigue siendo válido (queda abajo).
  const score = (c) => c.puntaje + (dioEnPlantel(c.profesor_id, s.materia_id, s.plantel) ? PLANTEL_BONUS : 0);
  const ordenados = [...cands].sort((a, b) => score(b) - score(a));

  // Restricción dura: el candidato debe estar LIBRE a esa hora (nadie en 2 lugares a la vez).
  const elegido = ordenados.find((c) => !(horario.get(c.profesor_id) || []).some((h) => overlap(h, s)));

  if (!elegido) {
    // Todos los candidatos fuertes ya están ocupados a esa hora -> queda sin maestro.
    // El diagnóstico (la alerta de choque) lo levanta el módulo compartido al final.
    asignados.push({ slot: s, profesor_id: null });
    continue;
  }

  // Nota de plantel en la razón, para que coordinación sepa si la sugerencia es local o cruza campus.
  const local = dioEnPlantel(elegido.profesor_id, s.materia_id, s.plantel);
  const otros = plantelesDe(elegido.profesor_id, s.materia_id).filter((p) => p !== s.plantel);
  const notaPlantel = local
    ? ` · Mismo plantel (${s.plantel}).`
    : (otros.length ? ` · Otro plantel: la dio en ${otros.join(", ")}.` : "");

  if (!horario.has(elegido.profesor_id)) horario.set(elegido.profesor_id, []);
  horario.get(elegido.profesor_id).push({ slot_id: s.id, dia: s.dia, ini: s.ini, fin: s.fin });
  carga.set(elegido.profesor_id, (carga.get(elegido.profesor_id) || 0) + 1);
  asignados.push({ slot: s, profesor_id: elegido.profesor_id, puntaje: score(elegido), razon: (elegido.razon ?? "") + notaPlantel });
}

// inserta asignaciones
for (const a of asignados) {
  await db.query(
    `insert into asignaciones (slot_id, profesor_id, estado, puntaje, razon, automatica)
     values ($1,$2,$3,$4,$5,true)`,
    [a.slot.id, a.profesor_id, a.profesor_id ? "sugerida" : "rechazada",
     a.puntaje ?? null, a.razon ?? null]);
}

// Las alertas (sobrecarga, docente_repetido, traslado_plantel, choque, sin_candidato, sin_aula)
// ya NO se calculan aquí: son un DIAGNÓSTICO del estado y las levanta el módulo compartido
// (src/lib/alertas-core.mjs) al final, una vez asignados docentes y aulas. Fuente de verdad única.

// ---- asignación de aulas (solo presenciales): el salón más chico que alcance y esté libre ----
// El Excel casi no llena el aula; aquí la plataforma la asigna sola evitando choques.
const aulaOcc = new Map();      // aula_id -> [{dia, ini, fin}]
const aulaDe = new Map();       // slot_id -> aula_id
let sinAula = 0;

// Aulas puestas a mano (aula_manual): se respetan y se marcan como ocupadas para que
// el auto-acomodo no programe otro grupo encima de ellas.
for (const s of slots) {
  if (s.aula_manual && s.aula_id) {
    if (!aulaOcc.has(s.aula_id)) aulaOcc.set(s.aula_id, []);
    aulaOcc.get(s.aula_id).push({ dia: s.dia, ini: s.ini, fin: s.fin });
  }
}

const presenciales = slots
  .filter((s) => (s.modalidad || "").toUpperCase() === "PRESENCIAL" && !s.aula_manual)
  .sort((a, b) => (b.alumnos ?? 0) - (a.alumnos ?? 0));   // grupos grandes reclaman aula primero

for (const s of presenciales) {
  const al = s.alumnos ?? null;
  const caben = aulas.filter((a) => al == null || a.capacidad >= al);
  const libre = caben.find((a) => !(aulaOcc.get(a.id) || []).some((o) => overlap(o, s)));
  if (libre) {
    if (!aulaOcc.has(libre.id)) aulaOcc.set(libre.id, []);
    aulaOcc.get(libre.id).push({ dia: s.dia, ini: s.ini, fin: s.fin });
    aulaDe.set(s.id, libre.id);
  } else {
    sinAula++;   // solo para el resumen; la alerta sin_aula la levanta el módulo compartido
  }
}
await db.query("update slots set aula_id = null where es_historial = false and aula_manual = false");
for (const [sid, aid] of aulaDe) {
  await db.query("update slots set aula_id = $1 where id = $2", [aid, sid]);
}

// ---- alertas: una sola fuente de verdad, sobre el estado ya escrito (docentes + aulas) ----
const { total: alertasTotal, porTipo } = await recomputarAlertas(query);

await db.query("commit");

// ---- resumen ----
const autoN = asignados.filter((a) => a.profesor_id).length;
const manualN = manualAsignados.filter((a) => a.profesor_id).length;
console.log(`Slots septiembre:        ${slots.length}`);
console.log(`  asignados (auto):      ${autoN}`);
console.log(`  asignados (manual):    ${manualN}  (preservados, no recalculados)`);
console.log(`  sin candidato fuerte:  ${sinCand}`);
console.log(`Aulas: ${presenciales.length} presenciales auto, ${aulaDe.size} con salón, ${sinAula} sin salón (las manuales se conservan)`);
console.log(`Alertas: ${alertasTotal}  ${JSON.stringify(porTipo)}`);
await db.end();
