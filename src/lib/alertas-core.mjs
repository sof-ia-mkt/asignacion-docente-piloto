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
// `cicloId` = el ciclo que se está asignando (las alertas son sobre ESE ciclo).
export async function calcularAlertas(query, cicloId) {
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

  // slots de septiembre con el docente asignado actual (si lo hay).
  // Traemos s.compactacion_id: los slots que comparten ese id son UNA sola clase
  // (un docente, un aula, un horario), aunque sean de carreras/grupos distintos.
  const rows = await query(
    `select s.id, s.materia_id, s.grupo_id, s.plantel, s.dia, s.hora_inicio, s.hora_fin, s.modalidad, s.aula_id,
            s.compactacion_id,
            m.nombre materia, g.clave grupo, g.alumnos, a.profesor_id
       from slots s
       left join materias m on m.id = s.materia_id
       left join grupos g on g.id = s.grupo_id
       left join asignaciones a on a.slot_id = s.id and a.profesor_id is not null
      where s.ciclo_id = $1 and not s.no_apertura`, [cicloId]);
  const slots = rows.map((s) => ({ ...s, ini: toMin(s.hora_inicio), fin: toMin(s.hora_fin) }));

  // CANDADO COMPACTACIÓN: una clase compactada cuenta UNA sola vez en TODO el diagnóstico
  // (carga, choque, repetido, aula). Identidad de "unidad": la compactación si existe, si no el slot.
  const unitKey = (s) => (s.compactacion_id ? `c${s.compactacion_id}` : `s${s.id}`);

  // horario y carga por profesor, a partir de las asignaciones actuales.
  // Colapsamos los slots compactados a una sola entrada por profesor: así no se ven como
  // dos clases encimadas (no son choque consigo mismas) ni inflan la carga.
  const horario = new Map();   // profesor_id -> [{slot_id, dia, ini, fin, materia, plantel, grupo_id}]
  const carga = new Map();
  const vistoUnidad = new Map();   // profesor_id -> Set(unitKey) ya contadas
  for (const s of slots) {
    if (!s.profesor_id) continue;
    const uk = unitKey(s);
    if (!vistoUnidad.has(s.profesor_id)) vistoUnidad.set(s.profesor_id, new Set());
    const visto = vistoUnidad.get(s.profesor_id);
    if (visto.has(uk)) continue;   // esta clase compactada ya se contó para este docente
    visto.add(uk);
    if (!horario.has(s.profesor_id)) horario.set(s.profesor_id, []);
    horario.get(s.profesor_id).push({ slot_id: s.id, dia: s.dia, ini: s.ini, fin: s.fin, materia: s.materia, plantel: s.plantel, grupo_id: s.grupo_id });
    carga.set(s.profesor_id, (carga.get(s.profesor_id) || 0) + 1);
  }

  const alertas = [];

  // 1) Clases SIN docente: nadie puede darla (sin_candidato) o todos sus candidatos chocan (choque).
  // Una clase compactada se reporta una sola vez (sus slots miembros son la misma clase).
  const vistoSinDocente = new Set();   // unitKey ya reportadas
  for (const s of slots) {
    if (s.profesor_id) continue;
    const uk = unitKey(s);
    if (vistoSinDocente.has(uk)) continue;
    vistoSinDocente.add(uk);
    const cands = porMateria.get(s.materia_id) || [];
    if (!cands.length) {
      alertas.push({
        tipo: "sin_candidato", severidad: "alta", slot_id: s.id, slot_id_2: null, profesor_id: null,
        detalle: `Nadie en el catálogo tiene historial ni CV para esta materia, así que el sistema no pudo proponer a nadie. Hay que buscar o contratar a un docente.`,
      });
      continue;
    }
    const libre = cands.find((c) => !(horario.get(c.profesor_id) || []).some((h) => overlap(h, s)));
    if (!libre) {
      const top = cands[0];
      const conf = (horario.get(top.profesor_id) || []).find((h) => overlap(h, s));
      // ¿Es el único candidato o hay más? Cambia el mensaje y la salida sugerida.
      const quien = cands.length === 1
        ? `Su único candidato, ${nombreCorto(top.nombre)},`
        : `Su mejor candidato (de ${cands.length}), ${nombreCorto(top.nombre)},`;
      const salida = cands.length === 1
        ? "Como es el único, tendrás que conseguir otro docente o mover el horario de una de las clases."
        : "Elige a otro de los candidatos disponibles o mueve el horario de una de las clases.";
      alertas.push({
        tipo: "choque_horario", severidad: "alta", slot_id: s.id, slot_id_2: conf?.slot_id ?? null, profesor_id: top.profesor_id,
        detalle: `Quedó sin maestro. ${quien} ya da "${conf?.materia ?? "otra clase"}" a esa misma hora, así que no puede tomar las dos. ${salida}`,
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
    // Si los grupos están compactados, son UNA clase: cuentan como un solo "grupo".
    porProfMat.get(k).grupos.add(s.compactacion_id ? `c${s.compactacion_id}` : `g${s.grupo_id}`);
  }
  for (const v of porProfMat.values()) {
    if (v.grupos.size >= REPETIDO_GRUPOS) alertas.push({
      tipo: "docente_repetido", severidad: "media", slot_id: v.slot, slot_id_2: null, profesor_id: v.prof,
      detalle: `Quedó en ${v.grupos.size} grupos distintos de esta materia. Muy concentrado en una sola persona; conviene repartir algunos grupos con otro docente.`,
    });
  }

  // 4) Traslado entre planteles el mismo día
  // CANDADO COMPACTACIÓN: una clase compactada es UNA sola (un docente, un aula, un horario, un
  // plantel) aunque tenga varios slots miembros; la contamos una vez por unidad para no inventar
  // un "traslado consigo misma".
  const porProfDia = new Map();
  const vistoTraslado = new Map();   // `${profesor_id}|${dia}` -> Set(unitKey) ya contadas
  for (const s of slots) {
    if (!s.profesor_id || !s.dia) continue;
    const k = `${s.profesor_id}|${s.dia}`;
    const uk = unitKey(s);
    if (!vistoTraslado.has(k)) vistoTraslado.set(k, new Set());
    const visto = vistoTraslado.get(k);
    if (visto.has(uk)) continue;   // esta clase compactada ya se contó este día
    visto.add(uk);
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
  const vistoSinAula = new Set();   // unitKey ya reportadas (una clase compactada = un aviso)
  for (const s of slots) {
    if ((s.modalidad || "").toUpperCase() !== "PRESENCIAL" || s.aula_id) continue;
    const uk = unitKey(s);
    if (vistoSinAula.has(uk)) continue;
    vistoSinAula.add(uk);
    const al = s.alumnos ?? null;
    const hayCupo = al == null || CAP_MAX >= al;
    alertas.push({
      tipo: "sin_aula", severidad: hayCupo ? "media" : "alta", slot_id: s.id, slot_id_2: null, profesor_id: null,
      detalle: hayCupo
        ? `No tiene salón asignado. Asígnale un aula o cambia el horario.`
        : `Ningún salón alcanza para ${al} alumnos (el más grande es de ${CAP_MAX}). Hay que dividir el grupo o conseguir un espacio mayor.`,
    });
  }

  // 6) Choque de aula: dos clases en el MISMO salón a horas que se enciman.
  // El motor evita esto al auto-acomodar; sólo aparece tras asignar un aula a mano.
  const porAula = new Map();   // aula_id -> [slot]
  const vistoAula = new Map(); // aula_id -> Set(unitKey): clases compactadas comparten aula a propósito
  for (const s of slots) {
    if (!s.aula_id) continue;
    const uk = unitKey(s);
    if (!vistoAula.has(s.aula_id)) vistoAula.set(s.aula_id, new Set());
    if (vistoAula.get(s.aula_id).has(uk)) continue;   // mismo aula y misma clase compactada: no es choque
    vistoAula.get(s.aula_id).add(uk);
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
export async function recomputarAlertas(query, cicloId) {
  // Candado serializador (a nivel de transacción): el patrón "borrar todas + insertar" NO es
  // seguro bajo concurrencia — dos recálculos encimados duplican el set completo de alertas.
  // Este advisory lock obliga a que se ejecuten uno por uno; se libera solo al commit/rollback
  // de quien nos envuelve (la app y el motor siempre nos llaman dentro de una transacción).
  await query("select pg_advisory_xact_lock(4928134751)", []);
  const alertas = await calcularAlertas(query, cicloId);
  // Solo borramos las alertas de ESTE ciclo: las de otros ciclos conviven (cada pantalla
  // filtra por el ciclo activo), así no se pierden ni se muestran viejas al cambiar de ciclo.
  await query("delete from alertas where ciclo_id = $1", [cicloId]);
  // Inserta TODAS las alertas en lotes multi-fila, no una por una. Con ~440 alertas, un
  // insert por fila son ~440 viajes de ida y vuelta al pooler remoto (~16 s, suficiente para
  // que la función serverless se corte en producción). Por lotes son 1-2 viajes (~100 ms).
  const LOTE = 500;
  for (let i = 0; i < alertas.length; i += LOTE) {
    const trozo = alertas.slice(i, i + LOTE);
    const params = [];
    const filas = trozo.map((al) => {
      const b = params.length;
      params.push(al.tipo, al.severidad, al.slot_id, al.slot_id_2, al.profesor_id, al.detalle, cicloId);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    await query(
      `insert into alertas (tipo, severidad, slot_id, slot_id_2, profesor_id, detalle, ciclo_id) values ${filas.join(",")}`,
      params);
  }
  const porTipo = {};
  for (const al of alertas) porTipo[al.tipo] = (porTipo[al.tipo] || 0) + 1;
  return { total: alertas.length, porTipo };
}
