-- Disponibilidad declarada por el docente en el formulario de Sep-Dic 2026:
-- horarios en que puede dar clase, grado, y la marca de tiempo de su respuesta.
-- Se guarda como jsonb para no perder el detalle; el motor la usa como señal
-- (candidatos fuente='disponibilidad') y, más adelante, para respetar sus ventanas.
alter table profesores add column if not exists disponibilidad jsonb;
