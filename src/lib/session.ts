// Sesión del lado servidor: leer/crear/cerrar la cookie de login y resolver quién
// está logueado AHORA (validando contra la base que siga activo). SOLO servidor.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { crearToken, leerToken } from "./session-token";
import { usuarioActivo, type UsuarioRow } from "./usuarios-db";
import { COOKIE_SESION } from "./session-cookie";

export { COOKIE_SESION };

/** Inicia sesión: guarda la cookie firmada con la versión de token actual del usuario. */
export async function abrirSesion(usuario: string, tokenVersion = 0): Promise<void> {
  const token = await crearToken(usuario, tokenVersion);
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

/** Persona logueada ahora (token válido + sigue activa en la base + versión vigente), o null.
 *  La versión corta las sesiones viejas cuando la persona (o un admin) cambia su contraseña. */
export async function sesionActual(): Promise<UsuarioRow | null> {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  const leido = await leerToken(token);
  if (!leido) return null;
  const u = await usuarioActivo(leido.usuario);
  if (!u) return null;
  if ((u.token_version ?? 0) !== leido.version) return null;   // contraseña cambiada → sesión vieja fuera
  return u;
}

/**
 * Candado para server actions que MUTAN datos: exige sesión válida y que la persona
 * no tenga pendiente el cambio de contraseña. El proxy protege las páginas, pero las
 * server actions (POST) no re-renderizan el layout, así que sin esto un usuario con la
 * temporal podría mutar antes de cambiarla. Devuelve el usuario.
 *
 * Redirige en vez de lanzar: un `throw` desde una server action se REDACTA en producción
 * (Next solo entrega un digest), así que la persona veía la pantalla de error genérica en
 * lugar de enterarse de que su sesión venció. Mandarla a donde tiene que ir es la respuesta
 * útil. `redirect()` funciona lanzando un error especial de Next, por eso DEBE llamarse
 * fuera de cualquier try/catch: las 41 llamadas a este candado están al inicio de su acción,
 * antes del try (verificado), y así hay que mantenerlas.
 */
export async function exigirSesionActiva(): Promise<UsuarioRow> {
  const yo = await sesionActual();
  if (!yo) redirect("/login?expirada=1");
  if (yo.debe_cambiar_password) redirect("/cambiar-password");
  return yo;
}
