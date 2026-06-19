// Acceso a la tabla `usuarios` (padrón en la base). SOLO servidor.
// El password_hash NUNCA sale de aquí salvo para verificar el login.
import { q } from "./db";
import { cifrarPassword } from "./password";

export type UsuarioRow = {
  id: number;
  usuario: string;
  nombre: string;
  correo: string | null;
  rol: string | null;
  carrera: string | null;
  es_admin: boolean;
  activo: boolean;
  debe_cambiar_password: boolean;
  creado_en: string;
};

// Tras 5 fallos seguidos, el login se bloquea por 15 minutos.
const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 15;

// Contraseña temporal compartida con la que se crea/resetea a un usuario. La persona
// debería cambiarla al entrar (pendiente). Vive aquí (no en una "use server") para poder
// importarla desde acciones y pantallas; el seed (scripts/cargar_usuarios.mjs) la replica.
export const PASSWORD_TEMP = "Cenyca!!23";

const COLS = "id, usuario, nombre, correo, rol, carrera, es_admin, activo, debe_cambiar_password, creado_en";

/** Trae el usuario (incluye hash y estado de bloqueo) para verificar el login. null si no existe o está inactivo. */
export async function usuarioParaLogin(
  login: string,
): Promise<(UsuarioRow & { password_hash: string; intentos_fallidos: number; bloqueado_hasta: string | null }) | null> {
  const [u] = await q<UsuarioRow & { password_hash: string; intentos_fallidos: number; bloqueado_hasta: string | null }>(
    `select ${COLS}, password_hash, intentos_fallidos, bloqueado_hasta from usuarios where usuario = $1 and activo = true`,
    [login.trim().toLowerCase()],
  );
  return u ?? null;
}

/** Suma un fallo de login; si llega al máximo, bloquea por BLOQUEO_MINUTOS. */
export async function registrarLoginFallido(id: number): Promise<void> {
  await q(
    `update usuarios
        set intentos_fallidos = intentos_fallidos + 1,
            bloqueado_hasta = case when intentos_fallidos + 1 >= $2
                                   then now() + ($3 || ' minutes')::interval
                                   else bloqueado_hasta end
      where id = $1`,
    [id, MAX_INTENTOS, String(BLOQUEO_MINUTOS)],
  );
}

/** Limpia el contador de fallos y el bloqueo (al entrar bien). */
export async function limpiarLoginFallidos(id: number): Promise<void> {
  await q(`update usuarios set intentos_fallidos = 0, bloqueado_hasta = null where id = $1`, [id]);
}

/** Usuario activo por login, sin el hash. Para validar la sesión en cada request. */
export async function usuarioActivo(login: string): Promise<UsuarioRow | null> {
  const [u] = await q<UsuarioRow>(
    `select ${COLS} from usuarios where usuario = $1 and activo = true`, [login],
  );
  return u ?? null;
}

/** Lista completa (activos e inactivos) para la pantalla de administración. */
export async function listarUsuarios(): Promise<UsuarioRow[]> {
  return q<UsuarioRow>(`select ${COLS} from usuarios order by activo desc, nombre`);
}

/** Nombres de los coordinadores activos: opciones del campo "coordinador" de cada docente. */
export async function nombresCoordinadores(): Promise<string[]> {
  const rows = await q<{ nombre: string }>(
    `select nombre from usuarios where activo = true order by nombre`,
  );
  return rows.map((r) => r.nombre);
}

export async function crearUsuario(d: {
  usuario: string; nombre: string; correo: string | null;
  rol: string | null; carrera: string | null; esAdmin: boolean; password: string;
}): Promise<void> {
  // debe_cambiar_password = true: la persona entra con la temporal y elige la suya.
  await q(
    `insert into usuarios (usuario, nombre, correo, rol, carrera, es_admin, password_hash, debe_cambiar_password)
     values ($1,$2,$3,$4,$5,$6,$7,true)`,
    [d.usuario.trim().toLowerCase(), d.nombre.trim(), d.correo, d.rol, d.carrera, d.esAdmin, cifrarPassword(d.password)],
  );
}

/** Reseteo por un admin: vuelve a la temporal y obliga a la persona a fijar una nueva. */
export async function resetearPassword(id: number, nuevaPassword: string): Promise<void> {
  await q(
    `update usuarios set password_hash = $2, debe_cambiar_password = true,
            intentos_fallidos = 0, bloqueado_hasta = null where id = $1`,
    [id, cifrarPassword(nuevaPassword)],
  );
}

/** Cambio hecho por la propia persona: fija su contraseña y apaga la bandera de cambio obligatorio. */
export async function cambiarPasswordPropia(id: number, nuevaPassword: string): Promise<void> {
  await q(
    `update usuarios set password_hash = $2, debe_cambiar_password = false,
            intentos_fallidos = 0, bloqueado_hasta = null where id = $1`,
    [id, cifrarPassword(nuevaPassword)],
  );
}

export async function fijarActivo(id: number, activo: boolean): Promise<void> {
  await q(`update usuarios set activo = $2 where id = $1`, [id, activo]);
}

export async function fijarAdmin(id: number, esAdmin: boolean): Promise<void> {
  await q(`update usuarios set es_admin = $2 where id = $1`, [id, esAdmin]);
}
