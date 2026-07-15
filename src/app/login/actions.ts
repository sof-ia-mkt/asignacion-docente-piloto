"use server";
import { redirect } from "next/navigation";
import { abrirSesion, cerrarSesion } from "@/lib/session";
import { usuarioParaLogin, registrarLoginFallido, limpiarLoginFallidos } from "@/lib/usuarios-db";
import { verificarPassword, cifrarPassword } from "@/lib/password";

export type LoginState = { error?: string };

// Hash señuelo: cuando el usuario NO existe se verifica contra esto de todos modos, para
// que el login tarde lo mismo que con un usuario real. Sin esto, la respuesta instantánea
// delataba qué nombres de usuario existen (enumeración por tiempos).
const HASH_SENUELO = cifrarPassword("senuelo-para-tiempo-uniforme");

export async function iniciarSesion(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const usuario = String(fd.get("usuario") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!usuario || !password) return { error: "Escribe tu usuario y contraseña." };

  const u = await usuarioParaLogin(usuario);

  // Bloqueo temporal tras varios fallos (anti fuerza bruta).
  if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    return { error: "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo." };
  }

  // Mismo mensaje Y mismo costo para usuario inexistente o contraseña mala: no revelamos
  // cuál falló ni por el texto ni por el tiempo de respuesta. La verificación se ejecuta
  // SIEMPRE (contra el señuelo si el usuario no existe) — sin corto circuito.
  const passwordOk = verificarPassword(password, u?.password_hash ?? HASH_SENUELO);
  if (!u || !passwordOk) {
    if (u) await registrarLoginFallido(u.id);
    return { error: "Usuario o contraseña incorrectos." };
  }

  await limpiarLoginFallidos(u.id);
  await abrirSesion(u.usuario);
  // Si entra con la temporal (o tras un reseteo), primero fija su propia contraseña.
  redirect(u.debe_cambiar_password ? "/cambiar-password" : "/");
}

export async function cerrarSesionAccion() {
  await cerrarSesion();
  redirect("/login");
}
