"use server";
import { redirect } from "next/navigation";
import { abrirSesion, cerrarSesion } from "@/lib/session";
import { usuarioParaLogin } from "@/lib/usuarios-db";
import { verificarPassword } from "@/lib/password";

export type LoginState = { error?: string };

export async function iniciarSesion(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const usuario = String(fd.get("usuario") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!usuario || !password) return { error: "Escribe tu usuario y contraseña." };

  const u = await usuarioParaLogin(usuario);
  // Mismo mensaje para usuario inexistente o contraseña mala: no revelamos cuál falló.
  if (!u || !verificarPassword(password, u.password_hash)) {
    return { error: "Usuario o contraseña incorrectos." };
  }

  await abrirSesion(u.usuario);
  redirect("/");
}

export async function cerrarSesionAccion() {
  await cerrarSesion();
  redirect("/login");
}
