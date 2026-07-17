-- ============================================================================
-- HORARIOS VÁLIDOS: limpia rangos invertidos/vacíos y agrega el candado CHECK
-- ============================================================================
-- Un rango con hora_inicio >= hora_fin nunca "traslapa" con nada (el predicado de
-- choque es `s2.hora_inicio < fin AND ini < s2.hora_fin`): esa clase puede empalmar
-- docente y aula EN SILENCIO. La captura ya lo rechaza (editarHorario/crearSlot),
-- pero los datos del Excel trajeron casos (detectado: slot 2738, "MARTES 20:00–20:00").
--
-- 1. Filas existentes con rango inválido → horario en blanco. Es honesto: ese
--    horario era basura, y la app las marca "sin horario, captúralo" (se conserva
--    el día como pista para coordinación).
update slots
   set hora_inicio = null, hora_fin = null
 where hora_inicio is not null and hora_fin is not null
   and hora_inicio >= hora_fin;

-- 2. Candado a nivel base: ningún INSERT/UPDATE futuro puede dejar un rango
--    invertido/vacío ni una hora suelta (inicio sin fin o viceversa), venga de la
--    app, de un script o de un ALTER manual. NOT VALID + VALIDATE: el ALTER no
--    bloquea la tabla revalidando todo con lock exclusivo, y el VALIDATE posterior
--    confirma (ya limpio por el paso 1) sin bloquear escrituras.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_slots_horario') then
    alter table slots add constraint chk_slots_horario
      check (
        ((hora_inicio is null) = (hora_fin is null))
        and (hora_inicio is null or hora_inicio < hora_fin)
      ) not valid;
  end if;
end $$;

alter table slots validate constraint chk_slots_horario;
