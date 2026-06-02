-- Distingue las aulas puestas a mano por coordinación de las que asigna el motor.
-- El motor (asignar.mjs) NO recalcula ni borra las aulas con aula_manual = true.
alter table slots add column if not exists aula_manual boolean not null default false;
