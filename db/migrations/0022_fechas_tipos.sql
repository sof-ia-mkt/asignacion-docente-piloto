-- 0022: fechas de impartición por TIPO de clase, por ciclo.
--
-- La Propuesta Académica (PDF/Excel) deja de marcar "Tentativa" y pasa a mostrar las fechas
-- reales de cada materia. La lógica del calendario CENYCA: el tipo determina el rango dentro
-- del cuatrimestre — DISCIPLINAR corre el periodo completo y los MÓDULOS son bloques
-- secuenciales. VIRTUAL no lleva fechas (esas clases no se ofertan a docentes).
--
-- Se guarda POR CICLO (jsonb en la fila del ciclo, junto a fecha_inicio/fecha_fin que ya
-- existían): abrir el siguiente cuatrimestre = capturar sus fechas con un UPDATE, sin deploy.
--
-- Idempotente: add column if not exists + update solo cuando aún no hay fechas capturadas.

alter table ciclos add column if not exists fechas_tipos jsonb;

comment on column ciclos.fechas_tipos is
  'Rangos de impartición por tipo de clase: {"DISCIPLINAR":["inicio","fin"], "MÓDULO 1":[...], ...} (ISO yyyy-mm-dd). Null en ciclos sin capturar.';

-- Fechas oficiales de coordinación para Septiembre–Diciembre 2026 (capturadas 2026-07-29):
--   DISCIPLINAR  07 sep – 13 dic   (todo el cuatrimestre)
--   MÓDULO 1     07 sep – 08 oct
--   MÓDULO 2     12 oct – 08 nov
--   MÓDULO 3     09 nov – 13 dic
update ciclos
   set fechas_tipos = '{
     "DISCIPLINAR": ["2026-09-07", "2026-12-13"],
     "MÓDULO 1":    ["2026-09-07", "2026-10-08"],
     "MÓDULO 2":    ["2026-10-12", "2026-11-08"],
     "MÓDULO 3":    ["2026-11-09", "2026-12-13"]
   }'::jsonb
 where codigo = '2026-2027-1'
   and fechas_tipos is null;
