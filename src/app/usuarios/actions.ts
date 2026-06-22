"use server";
import { revalidatePath } from "next/cache";
import { sesionActual } from "@/lib/session";
import { crearUsuario, resetearPassword, fijarActivo, fijarAdmin, tieneAccesoTotal, ROL_DIRECCION_GENERAL, PASSWORD_TEMP } from "@/lib/usuarios-db";

// Candado de servidor (no solo de UI): toda acción de administración exige acceso total
// (admin clásico o Dirección General).
async function exigirAdmin() {
  const u = await sesionActual();
  if (!u || !tieneAccesoTotal(u)) throw new Error("No autorizado: solo administradores.");
  return u;
}

const ROLES_VALIDOS = new Set(["academica", "carrera", ROL_DIRECCION_GENERAL, ""]);

export type CrearUsuarioState = { error?: string; ok?: string };

export async function crearUsuarioAccion(_prev: CrearUsuarioState, fd: FormData): Promise<CrearUsuarioState> {
  await exigirAdmin();
  const usuario = String(fd.get("usuario") ?? "").trim().toLowerCase();
  const nombre = String(fd.get("nombre") ?? "").trim();
  const correo = String(fd.get("correo") ?? "").trim() || null;
  const rolRaw = String(fd.get("rol") ?? "").trim();
  const carrera = String(fd.get("carrera") ?? "").trim() || null;
  const esAdmin = fd.get("es_admin") === "on";

  if (!nombre) return { error: "Escribe el nombre." };
  if (!/^[a-z0-9.]+$/.test(usuario)) return { error: "Usuario inválido: usa minúsculas, números y puntos (ej. nombre.apellido)." };
  if (!ROLES_VALIDOS.has(rolRaw)) return { error: "Rol inválido." };
  const rol = rolRaw || null;

  try {
    await crearUsuario({ usuario, nombre, correo, rol, carrera, esAdmin, password: PASSWORD_TEMP });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate") || msg.includes("unique")) return { error: `El usuario "${usuario}" ya existe.` };
    return { error: "No se pudo crear el usuario." };
  }
  revalidatePath("/usuarios");
  revalidatePath("/", "layout");
  return { ok: `Usuario "${usuario}" creado. Contraseña temporal: ${PASSWORD_TEMP}` };
}

export async function resetearPasswordAccion(id: number) {
  await exigirAdmin();
  await resetearPassword(id, PASSWORD_TEMP);
  revalidatePath("/usuarios");
}

export async function fijarActivoAccion(id: number, activo: boolean) {
  const yo = await exigirAdmin();
  if (id === yo.id && !activo) throw new Error("No puedes desactivarte a ti mismo.");
  await fijarActivo(id, activo);
  revalidatePath("/usuarios");
  revalidatePath("/", "layout");
}

export async function fijarAdminAccion(id: number, esAdmin: boolean) {
  const yo = await exigirAdmin();
  if (id === yo.id && !esAdmin) throw new Error("No puedes quitarte a ti mismo el admin.");
  await fijarAdmin(id, esAdmin);
  revalidatePath("/usuarios");
  revalidatePath("/", "layout");
}
