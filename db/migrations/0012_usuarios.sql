-- Usuarios de la plataforma (login propio + administración).
-- Antes el acceso era un candado único (Basic Auth con una sola contraseña) y el
-- padrón vivía en código. Ahora cada persona entra con SU usuario y contraseña, y
-- los admins pueden dar de alta gente y resetear contraseñas desde la pantalla, así
-- que el padrón vive en la base.
--
--   usuario       = login (en minúsculas), único. Identifica a la PERSONA.
--   nombre        = cómo se muestra (filtros, selects, bitácora).
--   correo        = contacto/notificación. Puede repetirse entre personas.
--   rol           = tipo de coordinación: 'academica' | 'carrera' | null (admin sin coordinación).
--   carrera       = solo coordinadores de carrera: de qué carrera son responsables.
--   es_admin      = puede administrar usuarios (alta, reseteo, desactivar, marcar admin).
--   password_hash = contraseña cifrada (scrypt). NUNCA en texto plano.
--   activo        = false = no puede entrar (baja sin borrar su rastro en la bitácora).
-- Aditiva e idempotente: crear de nuevo no borra ni toca datos existentes.
create table if not exists usuarios (
  id            bigserial primary key,
  usuario       text        not null unique,
  nombre        text        not null,
  correo        text,
  rol           text,
  carrera       text,
  es_admin      boolean     not null default false,
  password_hash text        not null,
  activo        boolean     not null default true,
  creado_en     timestamptz not null default now()
);

create index if not exists usuarios_usuario_idx on usuarios (usuario);
