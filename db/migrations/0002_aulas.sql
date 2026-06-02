-- 0002 — Aulas (salones) y cupo de alumnos.
-- Solo AGREGA estructura; no borra datos existentes (asignaciones del demo se conservan).

-- Catálogo de salones (hoja "Aulas" del Excel).
create table if not exists aulas (
  id          serial primary key,
  clave       text not null unique,   -- "104", "LABORATORIO DE CÓMPUTO #1 / 201"
  tipo        text,                   -- Teoría | Práctica
  capacidad   int
);

-- Alumnos por grupo (hoja "ALUMNOS POR MATERIA"; la columna ALUMNOS de CB viene vacía).
alter table grupos add column if not exists alumnos int;

-- Aula asignada a cada slot (en el Excel casi nunca está; la plataforma la recomienda).
alter table slots add column if not exists aula_id int references aulas(id);
create index if not exists idx_slots_aula on slots(aula_id);
