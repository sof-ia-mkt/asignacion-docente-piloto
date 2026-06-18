-- ============================================================================
-- CICLOS COMO DIMENSIÓN REAL  (reemplaza el truco binario es_historial)
-- ============================================================================
-- Hasta ahora "qué ciclo es" se decía con el booleano slots.es_historial:
--   es_historial = true  -> mayo (historial, solo lectura)
--   es_historial = false -> septiembre (el que se está asignando)
-- Eso solo soporta UN ciclo activo a la vez. Esta migración crea una tabla
-- propia de ciclos para poder tener MUCHOS (mayo, septiembre, y los que vengan),
-- elegir cuál se está asignando con un selector, y que la recomendación use
-- TODO el historial (todos los ciclos pasados), no solo mayo.
--
-- Es ADITIVA: NO borra es_historial todavía (el código aún lo usa). Primero
-- queda el modelo nuevo conviviendo; cuando el código ya lea ciclo_id, una
-- migración posterior retira es_historial. Idempotente: se puede correr 2 veces.

-- ---------- 1. Catálogo de ciclos ----------
create table if not exists ciclos (
  id            serial primary key,
  codigo        text not null unique,   -- '2025-2026-3' | '2026-2027-1'  (la clave que ya vive en slots.ciclo)
  nombre        text not null,          -- etiqueta humana: 'Mayo–Agosto 2026'
  estado        text not null,          -- 'historial' (cerrado, alimenta la recomendación) | 'planeacion' (el que se asigna)
  es_activo     boolean not null default false,  -- el ciclo que el selector muestra por defecto
  orden         int not null default 0, -- para ordenar el menú (más reciente arriba)
  fecha_inicio  date,
  fecha_fin     date,
  creado_en     timestamptz not null default now()
);

-- Solo UN ciclo puede ser el activo por defecto.
create unique index if not exists idx_ciclos_un_activo on ciclos(es_activo) where es_activo;

-- ---------- 2. Sembrar los dos ciclos que ya existen ----------
-- Se leen de los valores distintos que ya hay en slots.ciclo, así que esto
-- refleja la base real (no inventa). estado/nombre/fechas se fijan a mano.
insert into ciclos (codigo, nombre, estado, es_activo, orden, fecha_inicio, fecha_fin)
values
  ('2025-2026-3', 'Mayo–Agosto 2026',        'historial',  false, 10, '2026-05-01', '2026-08-31'),
  ('2026-2027-1', 'Septiembre–Diciembre 2026','planeacion', true,  20, '2026-09-01', '2026-12-31')
on conflict (codigo) do nothing;

-- ---------- 3. Enlazar cada slot a su ciclo (FK real, no texto suelto) ----------
alter table slots add column if not exists ciclo_id int references ciclos(id);

-- Rellenar el enlace a partir del texto que ya traía cada slot.
update slots s set ciclo_id = c.id
from ciclos c
where s.ciclo = c.codigo and s.ciclo_id is null;

create index if not exists idx_slots_ciclo_id on slots(ciclo_id);
