-- Ciclo de vida de la PROPUESTA (por docente): borrador → enviada → confirmada.
--   borrador   = se le están armando sus materias (estado inicial).
--   enviada    = se le mandó el PDF por correo; esperando su respuesta.
--   confirmada = el docente aceptó y el COORDINADOR la confirmó a mano (acto forzoso, nunca automático).
-- Aditiva e idempotente: los docentes existentes arrancan en 'borrador'.
alter table profesores add column if not exists propuesta_estado text not null default 'borrador';
alter table profesores add column if not exists propuesta_enviada_en timestamptz;
alter table profesores add column if not exists propuesta_confirmada_en timestamptz;
