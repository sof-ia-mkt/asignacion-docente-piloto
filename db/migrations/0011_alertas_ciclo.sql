-- Hasta ahora la tabla de alertas se borraba COMPLETA y se reinsertaba para el ciclo que
-- se estaba asignando, así que solo guardaba el último ciclo recalculado. Al haber varios
-- ciclos (mayo histórico + septiembre a asignar + futuros), eso mostraba alertas viejas del
-- ciclo anterior si el coordinador cambiaba de ciclo sin recalcular.
-- Le damos un ciclo_id a cada alerta para que convivan y cada pantalla filtre por el ciclo activo.
alter table alertas add column if not exists ciclo_id int references ciclos(id) on delete cascade;

-- Backfill: deducir el ciclo desde el slot de la alerta (la mayoría lo tienen).
update alertas a set ciclo_id = s.ciclo_id
  from slots s where a.slot_id = s.id and a.ciclo_id is null;

-- Las alertas sin slot (p.ej. sobrecarga) que quedaran huérfanas se asignan al ciclo en
-- planeación activo (el que se estaba asignando cuando se generaron).
update alertas set ciclo_id = (
    select id from ciclos where estado='planeacion' order by es_activo desc, orden desc limit 1)
  where ciclo_id is null;

create index if not exists idx_alertas_ciclo on alertas(ciclo_id);
