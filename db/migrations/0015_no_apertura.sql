-- Columna slots.no_apertura: marca las clases que NO se aperturan (parqueadas).
-- Se usa en toda la app (asignación, alertas, dashboards, motor) pero nunca se había
-- registrado en una migración: vivía solo en producción por un ALTER manual. Esto la deja
-- reproducible para reconstruir la base desde cero. Es ADITIVO e idempotente: no toca datos.
alter table slots add column if not exists no_apertura boolean not null default false;
