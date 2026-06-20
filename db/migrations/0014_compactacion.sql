-- Compactación de grupos: juntar en UNA sola clase (un docente, un aula, un horario)
-- la misma materia que se abre en varios grupos/carreras del mismo plantel.
-- Todo es ADITIVO e idempotente: no borra ni cambia nada de lo existente.

-- 1) Marca manual de "grupo chico": el coordinador la pone con su criterio, exista o no
--    el número de alumnos (que muchas veces no se captura). No depende de 'alumnos'.
alter table grupos add column if not exists es_chico boolean not null default false;

-- 2) Contenedor de "clase compactada". Agrupa los slots que se dan juntos.
--    'razon' = comentario del coordinador (por qué se compactó); queda en la pantalla y en bitácora.
create table if not exists compactaciones (
  id          serial primary key,
  ciclo_id    int references ciclos(id),
  materia_id  int references materias(id),
  plantel     text,
  razon       text,
  creado_en   timestamptz not null default now()
);
-- Para bases donde la tabla ya existía sin la columna de razón (estado previo de planeación):
alter table compactaciones add column if not exists razon text;

-- 3) Enlace slot ↔ clase compactada. NULL = la clase no está compactada (caso normal).
alter table slots add column if not exists compactacion_id int references compactaciones(id);
create index if not exists idx_slots_compactacion on slots(compactacion_id);
