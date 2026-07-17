-- ============================================================================
-- OFICIALIZA EL ÍNDICE ÚNICO REAL DE materia_candidatos  (corrige drift de esquema)
-- ============================================================================
-- Detectado en auditoría (2026-07): la base de producción tiene el constraint
--   materia_candidatos_prof_mat_uniq UNIQUE (profesor_id, materia_id)
-- creado con un ALTER manual que NUNCA se versionó. La migración 0001 declara otro
-- (unique (profesor_id, materia_id, fuente)), así que una base reconstruida desde
-- migraciones rompe en runtime: todos los "on conflict (profesor_id, materia_id)"
-- del código (actions.ts, ingest_cvs.mjs, cargar_disponibilidad.mjs, cargar_planteles.mjs)
-- fallan con "no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- Esta migración hace oficial el estado REAL: una sola fila por profesor+materia
-- (la fila conserva la fuente/puntaje ganador; la semántica "historial+cv suman"
-- queda como decisión de producto pendiente — ver auditoría).
--
-- Idempotente y sin cambio de comportamiento en producción (el constraint ya existe ahí).

do $$
declare
  viejo text;
begin
  -- 1. Si existe el unique de 3 columnas del esquema viejo (base reconstruida), se retira.
  --    Se busca por estructura (no por nombre) por si el nombre autogenerado difiere.
  select con.conname into viejo
    from pg_constraint con
   where con.conrelid = 'materia_candidatos'::regclass
     and con.contype = 'u'
     and array_length(con.conkey, 1) = 3;
  if viejo is not null then
    execute format('alter table materia_candidatos drop constraint %I', viejo);
  end if;

  -- 2. Crear el unique real de 2 columnas si aún no existe.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'materia_candidatos'::regclass
       and contype = 'u'
       and array_length(conkey, 1) = 2
  ) then
    -- Dedup previa (solo aplica en bases del esquema viejo, donde un profesor+materia
    -- podía tener fila por 'historial' Y por 'cv'): se conserva la de mayor puntaje;
    -- en empate, gana 'historial' (la señal fuerte documentada).
    delete from materia_candidatos mc
     using materia_candidatos mejor
     where mejor.profesor_id = mc.profesor_id
       and mejor.materia_id = mc.materia_id
       and mejor.ctid <> mc.ctid
       and (mejor.puntaje > mc.puntaje
            or (mejor.puntaje = mc.puntaje and mejor.fuente = 'historial' and mc.fuente <> 'historial')
            or (mejor.puntaje = mc.puntaje and mejor.fuente = mc.fuente and mejor.ctid > mc.ctid));

    alter table materia_candidatos
      add constraint materia_candidatos_prof_mat_uniq unique (profesor_id, materia_id);
  end if;
end $$;
