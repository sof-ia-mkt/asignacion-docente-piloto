-- Coordinador(a) académico responsable de asignar al docente.
-- Texto libre por simplicidad del piloto; la app lo restringe a la lista vigente (src/lib/ui.tsx).
alter table profesores add column if not exists coordinador text;
