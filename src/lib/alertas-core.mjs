// Cálculo de alertas a partir del ESTADO ACTUAL (las asignaciones tal como están).
// Fuente de verdad ÚNICA: la usan el motor (scripts/asignar.mjs) y la app (recálculo en vivo).
// Se inyecta `query(sql, params) => Promise<rows[]>` para servir a ambos mundos
// (el pg.Client del script y el pool de la app).
//
// Las alertas son un DIAGNÓSTICO del estado, no deciden a quién asignar. Por eso se
// pueden recalcular tras cualquier edición sin re-acomodar docentes.

const SCORE_MIN = 25;          // candidato "fuerte" (historial 40, cv-alta 25)
const SOBRECARGA_SLOTS = 12;   // > este número de clases => sobrecarga
const TRASLADO_MIN = 60;       // < este margen entre 2 planteles el mismo día => traslado imposible
const REPETIDO_GRUPOS = 6;     // misma materia en >= este nº de grupos => sobre-concentración
const PLACEHOLDERS = ["CAMBIO DE TURNO", "DOCENTE NUEVO", "NO SE APERTURA", "NOSE APERTURA"];

const toMin = (h) => { if (!h) return null; const [a, b] = String(h).split(":").map(Number); return a * 60 + b; };
const nombreCorto = (n) => (n ?? "").toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
const overlap = (a, b) =>
  a.dia && b.dia && a.dia === b.dia &&
  a.ini != null && b.ini != null && a.fin != null && b.fin != null &&
  a.ini < b.fin && b.ini < a.fin;

// Devuelve el arreglo de alertas calculado desde el estado actual. NO escribe.
export async function calcularAlertas(query) {
  // candidatos fuertes por materia
  const cand = await query(
    `select mc.materia_id, mc.profesor_id, max(p.nombre) nombre, sum(mc.puntaje)::int puntaje
       from materia_candidatos mc join profesores p on p.id = mc.profesor_id
      where mc.puntaje >= $1 and p.nombre <> all($2)
      group by mc.materia_id, mc.profesor_id`, [SCORE_MIN, PLACEHOLDERS]);
  const porMateria = new Map();
  for (const c of cand) {
    if (!porMateria.has(c.materia_id)) porMateria.set(c.materia_id, []);
    porMateria.get(c.materia_id).push(c);
  }
  for (const arr of porMateria.values()) arr.sort((a, b) => b.puntaje - a.puntaje);

  // slots de septiembre con el docente asignado actual (si lo hay)
  const rows = await query(
    `select s.id, s.materia_id, s.grupo_id, s.plantel, s.dia, s.hora_inicio, s.hora_fin, s.modalidad, s.aula_id,
            m.nombre materia, g.clave grupo, g.alumnos, a.profesor_id
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join asignaciones a on a.slot_id = s.id and a.profesor_id is not null
      where s.es_historial = false`);
  const slots = rows.map((s) => ({ ...s, ini: toMin(s.hora_inicio), fin: toMin(s.hora_fin) }));

  // horario y carga por profesor, a partir de las asignaciones actuales
  const horario = new Map();   // profesor_id -> [{slot_id, dia, ini, fin, materia, plantel, grupo_id}]
  const carga = new Map();
  for (const s of slots) {
    if (!s.profesor_id) continue;
    if (!horario.has(s.profesor_id)) horario.set(s.profesor_id, []);
    horario.get(s.profesor_id).push({ slot_id: s.id, dia: s.dia, ini: s.ini, fin: s.fin, materia: s.materia, plantel: s.plantel, grupo_id: s.grupo_id });
    carga.set(s.profesor_id, (carga.get(s.profesor_id) || 0) + 1);
  }

  const alertas = [];

  // 1) Clases SIN docente: nadie puede darla (sin_candidato) o todos sus candidatos chocan (choque)
  for (const s of slots) {
    if (s.profesor_id) continue;
    const cands = porMateria.get(s.materia_id) || [];
    if (!cands.length) {
      alertas.push({
        tipo: "sin_candidato", severidad: "alta", slot_id: s.id, slot_id_2: null, profesor_id: null,
        detalle: `Nadie en el sistema puede dar "${s.materia}" (${s.grupo ?? "sin grupo"}). Hay que buscar o contratar a un docente para esta clase.`,
      });
      continue;
    }
    const libre = cands.find((c) => !(horario.get(c.profesor_id) || []).some((h) => overlap(h, s)));
    if (!libre) {
      const top = cands[0];
      const conf = (horario.get(top.profesor_id) || []).find((h) => overlap(h, s));
      alertas.push({
        tipo: "choque_horario", severidad: "alta", slot_id: s.id, slot_id_2: conf?.slot_id ?? null, profesor_id: top.profesor_id,
        detalle: `"${s.materia}" (${s.grupo}), ${s.dia} ${s.hora_inicio}-${s.hora_fin}: quedó sin maestro. El mejor candidato (${nombreCorto(top.nombre)}) ya da "${conf?.materia ?? "otra clase"}" a esa misma hora, así que no puede tomar las dos. Elige otro docente disponible o cambia el horario de una de las clases.`,
      });
    }
    // Si hay un candidato libre pero el slot sigue vacío, es "sin docente" (no es alerta: es una oportunidad).
  }

  // 1b) Doble reserva: un docente YA asignado a dos clases que se enciman (típico tras una edición manual)
  for (const [pid, hs] of horario) {
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
      if (overlap(hs[i], hs[j])) {
        alertas.push({
          tipo: "choque_horario", severidad: "alta", slot_id: hs[i].slot_id, slot_id_2: hs[j].slot_id, profesor_id: Number(pid),
          detalle: `El docente quedó con dos clases encimadas el ${hs[i].dia}: "${hs[i].materia}" y "${hs[j].materia}" a la misma hora. Cambia el horario de una o pásala a otro docente.`,
        });
      }
    }
  }

  // 2) Sobrecarga
  for (const [pid, n] of carga) {
    if (n > SOBRECARGA_SLOTS) alertas.push({
      tipo: "sobrecarga", severidad: n > SOBRECARGA_SLOTS * 1.5 ? "alta" : "media", slot_id: null, slot_id_2: null, profesor_id: Number(pid),
      detalle: `Tiene ${n} clases asignadas en septiembre; lo recomendable es máximo ${SOBRECARGA_SLOTS}. Puede estar sobrecargado: considera pasar algunas a otro docente.`,
    });
  }

  // 3) Docente repetido (misma materia en muchos grupos)
  const porProfMat = new Map();
  for (const s of slots) {
    if (!s.profesor_id) continue;
    const k = `${s.profesor_id}|${s.materia_id}`;
    if (!porProfMat.has(k)) porProfMat.set(k, { prof: s.profesor_id, materia: s.materia, grupos: new Set(), slot: s.id });
    porProfMat.get(k).grupos.add(s.grupo_id);
  }
  for (const v of porProfMat.values()) {
    if (v.grupos.size >= REPETIDO_GRUPOS) alertas.push({
      tipo: "docente_repetido", severidad: "media", slot_id: v.slot, slot_id_2: null, profesor_id: v.prof,
      detalle: `Da "${v.materia}" en ${v.grupos.size} grupos distintos. Está muy concentrado en una sola materia; conviene repartir algunos grupos con otro docente.`,
    });
  }

  // 4) Traslado entre planteles el mismo día
  const porProfDia = new Map();
  for (const s of slots) {
    if (!s.profesor_id || !s.dia) continue;
    const k = `${s.profesor_id}|${s.dia}`;
    if (!porProfDia.has(k)) porProfDia.set(k, []);
    porProfDia.get(k).push({ plantel: s.plantel, ini: s.ini, fin: s.fin, slot_id: s.id });
  }
  for (const [k, clases] of porProfDia) {
    const planteles = [...new Set(clases.map((c) => c.plantel).filter(Boolean))];
    if (planteles.length < 2) continue;
    const [pid, dia] = k.split("|");
    let margenMin = Infinity;
    for (let i = 0; i < clases.length; i++) for (let j = i + 1; j < clases.length; j++) {
      const a = clases[i], b = clases[j];
      if (a.plantel === b.plantel || a.ini == null || a.fin == null || b.ini == null || b.fin == null) continue;
      margenMin = Math.min(margenMin, a.ini <= b.ini ? b.ini - a.fin : a.ini - b.fin);
    }
    const imposible = margenMin < TRASLADO_MIN;
    alertas.push({
      tipo: "traslado_plantel", severidad: imposible ? "alta" : "media",
      slot_id: clases[clases.length - 1].slot_id, slot_id_2: null, profesor_id: Number(pid),
      detalle: imposible
        ? `El ${dia} tiene clases en ${planteles.join(" y ")} con solo ${margenMin === Infinity ? "?" : margenMin} min entre una y otra: no le alcanza para trasladarse. Hay que mover una clase o cambiar de docente.`
        : `El ${dia} da clases en ${planteles.join(" y ")} el mismo día. Revisa que le dé tiempo de trasladarse entre planteles.`,
    });
  }

  // 5) Sin aula: clase presencial sin salón asignado
  const aulas = await query("select id, clave, capacidad from aulas", []);
  const claveAula = new Map(aulas.map((a) => [a.id, a.clave]));
  const conCupo = aulas.filter((a) => a.capacidad != null);
  const CAP_MAX = conCupo.length ? Math.max(...conCupo.map((a) => a.capacidad)) : 0;
  for (const s of slots) {
    if ((s.modalidad || "").toUpperCase() !== "PRESENCIAL" || s.aula_id) continue;
    const al = s.alumnos ?? null;
    const hayCupo = al == null || CAP_MAX >= al;
    alertas.push({
      tipo: "sin_aula", severidad: hayCupo ? "media" : "alta", slot_id: s.id, slot_id_2: null, profesor_id: null,
      detalle: hayCupo
        ? `"${s.materia}" (${s.grupo}), ${s.dia ?? "sin día"} ${s.hora_inicio ?? ""}-${s.hora_fin ?? ""}: no tiene salón asignado. Asígnale un aula o cambia el horario.`
        : `"${s.materia}" (${s.grupo}): ningún salón alcanza para ${al} alumnos (el más grande es de ${CAP_MAX}). Hay que dividir el grupo o conseguir un espacio mayor.`,
    });
  }

  // 6) Choque de aula: dos clases en el MISMO salón a horas que se enciman.
  // El motor evita esto al auto-acomodar; sólo aparece tras asignar un aula a mano.
  const porAula = new Map();   // aula_id -> [slot]
  for (const s of slots) {
    if (!s.aula_id) continue;
    if (!porAula.has(s.aula_id)) porAula.set(s.aula_id, []);
    porAula.get(s.aula_id).push(s);
  }
  for (const [aulaId, lista] of porAula) {
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
      if (!overlap(lista[i], lista[j])) continue;
      const a = lista[i], b = lista[j];
      alertas.push({
        tipo: "choque_aula", severidad: "alta", slot_id: a.id, slot_id_2: b.id, profesor_id: null,
        detalle: `El salón ${claveAula.get(aulaId) ?? "?"} tiene dos clases encimadas el ${a.dia}: "${a.materia}" (${a.grupo ?? "?"}) y "${b.materia}" (${b.grupo ?? "?"}) a la misma hora. Cambia de aula o de horario una de las dos.`,
      });
    }
  }

  return alertas;
}

// Recalcula y GUARDA (borra las anteriores e inserta las nuevas). Devuelve un resumen.
// El control de transacción lo decide quien llama (la app la envuelve; el motor ya está en una).
export async function recomputarAlertas(query) {
  const alertas = await calcularAlertas(query);
  await query("delete from alertas", []);
  for (const al of alertas) {
    await query(
      `insert into alertas (tipo, severidad, slot_id, slot_id_2, profesor_id, detalle) values ($1,$2,$3,$4,$5,$6)`,
      [al.tipo, al.severidad, al.slot_id, al.slot_id_2, al.profesor_id, al.detalle]);
  }
  const porTipo = {};
  for (const al of alertas) porTipo[al.tipo] = (porTipo[al.tipo] || 0) + 1;
  return { total: alertas.length, porTipo };
}
