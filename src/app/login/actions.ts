"use server";
import { redirect } from "next/navigation";
import { abrirSesion, cerrarSesion } from "@/lib/session";
import { usuarioParaLogin, registrarLoginFallido, limpiarLoginFallidos } from "@/lib/usuarios-db";
import { verificarPassword } from "@/lib/password";

export type LoginState = { error?: string };

export async function iniciarSesion(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const usuario = String(fd.get("usuario") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!usuario || !password) return { error: "Escribe tu usuario y contraseña." };

  const u = await usuarioParaLogin(usuario);

  // Bloqueo temporal tras varios fallos (anti fuerza bruta).
  if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    return { error: "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo." };
  }

  // Mismo mensaje para usuario inexistente o contraseña mala: no revelamos cuál falló.
  if (!u || !verificarPassword(password, u.password_hash)) {
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
