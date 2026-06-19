-- Endurecimiento de seguridad del login (aditiva e idempotente).
--
--   debe_cambiar_password = la persona debe fijar SU contraseña antes de usar la plataforma.
--     Se prende al crear un usuario y al resetear su contraseña (cuando queda en la temporal
--     compartida); se apaga cuando la persona elige una contraseña propia.
--   intentos_fallidos     = fallos de login consecutivos. Se limpia al entrar bien.
--   bloqueado_hasta       = si > now(), el login se rechaza (anti fuerza bruta).
--
-- Al CREAR la columna debe_cambiar_password forzamos true a los usuarios ya existentes,
-- porque hasta ahora todos comparten la contraseña temporal. El update va dentro del IF
-- para que sea idempotente: en corridas posteriores la columna ya existe y no se re-fuerza
-- a quien ya cambió su contraseña.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'usuarios' and column_name = 'debe_cambiar_password'
  ) then
    alter table usuarios add column debe_cambiar_password boolean not null default false;
    update usuarios set debe_cambiar_password = true;
  end if;
end $$;

alter table usuarios add column if not exists intentos_fallidos int not null default 0;
alter table usuarios add column if not exists bloqueado_hasta timestamptz;
