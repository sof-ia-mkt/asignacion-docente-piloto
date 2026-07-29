-- 0021: cierra el Data API (PostgREST) para los roles públicos anon/authenticated.
--
-- Por qué no rompe la app (verificado antes de escribir esto, no asumido):
--   - La app habla Postgres directo (SUPABASE_DB_URL) como `postgres`, que tiene rolbypassrls
--     = true: RLS no la afecta.
--   - El bucket de CVs se firma con SUPABASE_SECRET_KEY (service_role), rol que NO se toca aquí.
--   - La anon key no se usa en ningún punto del código ni viaja al navegador (solo la URL).
-- Esto es el "se endurece en fase 2" que anticipaba 0001_init.sql, no un cambio de rumbo:
--   antes de esta migración, anon podía leer Y escribir todo por REST, incluidos los hashes
--   de contraseña de `usuarios`.
--
-- Doble candado, para que reactivar algo en el dashboard no vuelva a abrir la puerta:
--   1) RLS activo y SIN políticas  -> deny-all para cualquier rol que no salte RLS.
--   2) Permisos revocados          -> ni siquiera se llega a evaluar RLS.
--
-- Cómo revertir (si algún día se quiere exponer el Data API a propósito):
--   grant usage on schema public to anon, authenticated;
--   grant select, insert, update, delete on all tables in schema public to anon, authenticated;
--   alter table public.<tabla> disable row level security;   -- por tabla
--
-- Idempotente: enable/revoke sobre algo ya aplicado es un no-op, así que migrate.mjs puede
-- re-correrla sin efectos. El guard de pg_roles la vuelve inofensiva en un Postgres sin Supabase.

do $$
declare
  t record;
  hay_roles boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated')
    into hay_roles;

  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    if hay_roles then
      execute format('revoke all on public.%I from anon, authenticated', t.tablename);
    end if;
  end loop;

  if hay_roles then
    -- Secuencias: sin esto anon podría seguir avanzando los serial de las tablas.
    revoke all on all sequences in schema public from anon, authenticated;
    -- El esquema mismo: sin USAGE no puede ni nombrar una tabla.
    revoke usage on schema public from anon, authenticated;
    -- Tablas futuras: Supabase las concede a anon por defecto. Como las migraciones corren
    -- como `postgres`, apagar su default privilege hace que una tabla nueva nazca cerrada.
    alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
    alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
  end if;
end $$;
