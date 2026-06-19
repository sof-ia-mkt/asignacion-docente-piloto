// Sesión del lado servidor: leer/crear/cerrar la cookie de login y resolver quién
// está logueado AHORA (validando contra la base que siga activo). SOLO servidor.
import { cookies } from "next/headers";
import { crearToken, leerToken } from "./session-token";
import { usuarioActivo, type UsuarioRow } from "./usuarios-db";
import { COOKIE_SESION } from "./session-cookie";

export { COOKIE_SESION };

/** Inicia sesión: guarda la cookie firmada. */
export async function abrirSesion(usuario: string): Promise<void> {
  const token = await crearToken(usuario);
  (await cookies()).set(COOKIE_SESION, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}

/** Cierra sesión: borra la cookie. */
export async function cerrarSesion(): Promise<void> {
  (await cookies()).delete(COOKIE_SESION);
}

/** Persona logueada ahora (token válido + sigue activa en la base), o null. */
export async function sesionActual(): Promise<UsuarioRow | null> {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  const login = await leerToken(token);
  if (!login) return null;
  return usuarioActivo(login);
}

/**
 * Candado para server actions que MUTAN datos: exige sesión válida y que la persona
 * no tenga pendiente el cambio de contraseña. El proxy protege las páginas, pero las
 * server actions (POST) no re-renderizan el layout, así que sin esto un usuario con la
 * temporal podría mutar antes de cambiarla. Devuelve el usuario; si no, lanza.
 */
export async function exigirSesionActiva(): Promise<UsuarioRow> {
  const yo = await sesionActual();
  if (!yo) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión para continuar.");
  if (yo.debe_cambiar_password)
    throw new Error("Debes cambiar tu contraseña temporal antes de hacer cambios en la plataforma.");
  return yo;
}
