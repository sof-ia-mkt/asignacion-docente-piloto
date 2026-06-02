-- Asignación Docente — Piloto CENYCA (CASA BLANCA)
-- Esquema inicial. Postgres / Supabase.
-- RLS desactivado en piloto: el acceso es solo coordinación (se endurece en fase 2).

-- ---------- Catálogos ----------
create table if not exists planes (
  id          serial primary key,
  nombre      text not null unique,
  slug        text not null unique
);

create table if not exists materias (
  id          serial primary key,
  nombre      text not null unique,   -- normalizada (upper, sin \n)
  slug        text not null unique
);

create table if not exists grupos (
  id            serial primary key,
  clave         text not null unique,  -- PLAN_Gnn_TURNO_CAMPUS
  plan_id       int references planes(id),
  cuatrimestre  text,
  turno         text
);

-- ---------- Docentes ----------
create table if not exists profesores (
  id                      serial primary key,
  nombre                  text not null unique,   -- normalizada
  slug                    text not null unique,
  licenciatura            text,
  maestria                text,
  area_cv                 text,        -- área inferida del CV (ground truth piloto)
  anios_experiencia       int,
  cv_archivo              text,        -- nombre del PDF en docs/cvs-demo
  es_coordinador_virtual  boolean not null default false
);

-- Lo que Claude extrae de cada CV (crudo, para auditoría)
create table if not exists cv_competencias (
  id            serial primary key,
  profesor_id   int not null references profesores(id) on delete cascade,
  payload       jsonb not null,        -- { areas, grados, anios, materias_sugeridas:[{materia, confianza}] }
  modelo        text,                  -- modelo de Claude usado
  creado_en     timestamptz not null default now(),
  unique (profesor_id)
);

-- ---------- Slots (programación) ----------
-- es_historial = true  -> ciclo mayo (2025-2026-3), docente real ya asignado
-- es_historial = false -> ciclo septiembre (2026-2027-1), a asignar (docente null)
create table if not exists slots (
  id                serial primary key,
  id_excel          int,
  plantel           text not null default 'CASA BLANCA',
  ciclo             text not null,        -- 2025-2026-3 | 2026-2027-1
  es_historial      boolean not null,
  plan_id           int references planes(id),
  grupo_id          int references grupos(id),
  materia_id        int references materias(id),
  cuatrimestre      text,
  tipo              text,                 -- DISCIPLINAR | MÓDULO 1/2/3 | VIRTUAL
  modalidad         text,                 -- PRESENCIAL | ASINCRÓNICA
  dia               text,
  turno             text,
  hora_inicio       text,                 -- 'HH:MM'
  hora_fin          text,
  fecha_inicio      date,
  fecha_fin         date,
  fecha_raw         text,
  confirmacion      text,
  docente_id        int references profesores(id),  -- mayo: real; septiembre: null hasta asignar
  creado_en         timestamptz not null default now()
);
create index if not exists idx_slots_ciclo on slots(ciclo);
create index if not exists idx_slots_materia on slots(materia_id);
create index if not exists idx_slots_docente on slots(docente_id);

-- ---------- Candidaturas (profe ↔ materia) ----------
-- Combina historial real (mayo) + lo inferido del CV.
create table if not exists materia_candidatos (
  id            serial primary key,
  profesor_id   int not null references profesores(id) on delete cascade,
  materia_id    int not null references materias(id) on delete cascade,
  fuente        text not null,        -- 'historial' | 'cv'
  puntaje       int not null default 0,
  razon         text,
  unique (profesor_id, materia_id, fuente)
);
create index if not exists idx_cand_materia on materia_candidatos(materia_id);

-- ---------- Asignaciones (resultado, ciclo septiembre) ----------
create table if not exists asignaciones (
  id            serial primary key,
  slot_id       int not null references slots(id) on delete cascade,
  profesor_id   int references profesores(id),
  estado        text not null default 'sugerida',  -- sugerida | confirmada | rechazada
  puntaje       int,
  razon         text,                 -- desglose del puntaje
  automatica    boolean not null default true,
  creado_en     timestamptz not null default now(),
  unique (slot_id)
);

-- ---------- Alertas ----------
create table if not exists alertas (
  id            serial primary key,
  tipo          text not null,        -- choque_horario | docente_repetido | sin_candidato | sobrecarga
  severidad     text not null default 'media',  -- alta | media | baja
  slot_id       int references slots(id) on delete cascade,
  slot_id_2     int references slots(id) on delete cascade,  -- para choques (el otro slot)
  profesor_id   int references profesores(id),
  detalle       text not null,
  creado_en     timestamptz not null default now()
);
create index if not exists idx_alertas_tipo on alertas(tipo);
