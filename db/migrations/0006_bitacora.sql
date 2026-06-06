-- Bitácora / historial de modificaciones (Fase 1: solo lectura).
-- Registra cada edición de COORDINACIÓN (no los recálculos automáticos de alertas).
-- Aditiva e idempotente: crear de nuevo no borra ni toca datos existentes.
--
--   entidad   = qué se tocó: docente | clase | aula | asignacion | candidatura | cv
--   entidad_id= id de esa entidad (cuando aplica; null si ya no existe, p.ej. tras borrar)
--   accion    = verbo legible: creó | editó | borró | asignó | quitó | confirmó | agregó | procesó
--   descripcion= frase lista para mostrar a coordinación
--   datos_antes / datos_despues = foto opcional (jsonb) para auditoría y, más adelante, deshacer
--   actor     = quién lo hizo. Hoy anónimo ('Coordinación'); se podrá personalizar después.
create table if not exists bitacora (
  id            bigserial primary key,
  creado_en     timestamptz not null default now(),
  actor         text        not null default 'Coordinación',
  entidad       text        not null,
  entidad_id    bigint,
  accion        text        not null,
  descripcion   text        not null,
  datos_antes   jsonb,
  datos_despues jsonb
);

-- La pantalla siempre ordena por fecha descendente (lo más reciente primero).
create index if not exists bitacora_creado_en_idx on bitacora (creado_en desc);
-- Para filtrar/buscar el historial de una entidad concreta.
create index if not exists bitacora_entidad_idx on bitacora (entidad, entidad_id);
