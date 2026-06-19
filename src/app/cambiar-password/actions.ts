"use server";
import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/session";
import { usuarioParaLogin, cambiarPasswordPropia } from "@/lib/usuarios-db";
import { verificarPassword, validarPasswordNueva } from "@/lib/password";

export type CambioState = { error?: string };

export async function cambiarPasswordAccion(_prev: CambioState, fd: FormData): Promise<CambioState> {
  const yo = await sesionActual();
  if (!yo) redirect("/login");

  const actual = String(fd.get("actual") ?? "");
  const nueva = String(fd.get("nueva") ?? "");
  const confirmar = String(fd.get("confirmar") ?? "");

  if (!actual || !nueva) return { error: "Llena todos los campos." };
  if (nueva !== confirmar) return { error: "La nueva contraseña y su confirmación no coinciden." };

  const motivo = validarPasswordNueva(nueva);
  if (motivo) return { error: motivo };

  // Verifica la contraseña actual (con el hash en la base) antes de cambiarla.
  const u = await usuarioParaLogin(yo.usuario);
  if (!u || !verificarPassword(actual, u.password_hash)) {
    return { error: "La contraseña actual no es correcta." };
  }
  if (verificarPassword(nueva, u.password_hash)) {
    return { error: "La nueva contraseña debe ser distinta de la actual." };
  }

  await cambiarPasswordPropia(yo.id, nueva);
  redirect("/");
}
