import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/session";
import { listarUsuarios, PASSWORD_TEMP } from "@/lib/usuarios-db";
import { Panel } from "@/lib/ui";
import { ConfirmButton } from "@/lib/confirm-button";
import { NuevoUsuarioForm } from "./form";
import {
  resetearPasswordAccion,
  fijarActivoAccion,
  fijarAdminAccion,
} from "./actions";

const ROL_LABEL: Record<string, string> = {
  academica: "Académica",
  carrera: "De carrera",
};

export default async function UsuariosPage() {
  const yo = await sesionActual();
  if (!yo) redirect("/login");
  if (!yo.es_admin) redirect("/");

  const usuarios = await listarUsuarios();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Usuarios</h1>
        <p className="text-sm text-slate-500 mt-1">
          Padrón de acceso a la plataforma. Solo los administradores pueden crear usuarios,
          resetear contraseñas, activar/desactivar o marcar admin.
        </p>
      </div>

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">Nombre</th>
                <th className="py-2 pr-3 font-medium">Usuario</th>
                <th className="py-2 pr-3 font-medium">Correo</th>
                <th className="py-2 pr-3 font-medium">Coordinación</th>
                <th className="py-2 pr-3 font-medium">Admin</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pl-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const soyYo = u.id === yo.id;
                return (
                  <tr key={u.id} className="border-b border-slate-100 align-middle">
                    <td className="py-2 pr-3 text-slate-900">
                      {u.nombre}
                      {soyYo && <span className="ml-1 text-xs text-slate-400">(tú)</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{u.usuario}</td>
                    <td className="py-2 pr-3 text-slate-500">{u.correo ?? "—"}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {u.rol ? ROL_LABEL[u.rol] ?? u.rol : "—"}
                      {u.carrera ? ` · ${u.carrera}` : ""}
                    </td>
                    <td className="py-2 pr-3">
                      {u.es_admin ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-slate-900 text-white border-slate-900">
                          admin
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {u.activo ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-green-100 text-green-800 border-green-200">
                          Activo
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium border bg-slate-100 text-slate-500 border-slate-200">
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="py-2 pl-3">
                      <div className="flex justify-end items-center gap-3 whitespace-nowrap">
                        <form action={resetearPasswordAccion.bind(null, u.id)}>
                          <ConfirmButton
                            message={`¿Resetear la contraseña de ${u.nombre} a la temporal (${PASSWORD_TEMP})? Tendrá que volver a entrar con esa contraseña.`}
                            className="text-blue-700 hover:underline text-xs">
                            Resetear contraseña
                          </ConfirmButton>
                        </form>

                        {!soyYo && (
                          <form action={fijarAdminAccion.bind(null, u.id, !u.es_admin)}>
                            <ConfirmButton
                              message={u.es_admin
                                ? `¿Quitarle el rol de administrador a ${u.nombre}?`
                                : `¿Hacer administrador a ${u.nombre}? Podrá crear usuarios y resetear contraseñas.`}
                              className="text-slate-700 hover:underline text-xs">
                              {u.es_admin ? "Quitar admin" : "Hacer admin"}
                            </ConfirmButton>
                          </form>
                        )}

                        {!soyYo && (
                          <form action={fijarActivoAccion.bind(null, u.id, !u.activo)}>
                            <ConfirmButton
                              message={u.activo
                                ? `¿Desactivar a ${u.nombre}? No podrá iniciar sesión hasta reactivarlo.`
                                : `¿Reactivar a ${u.nombre}?`}
                              className={`${u.activo ? "text-red-700" : "text-green-700"} hover:underline text-xs`}>
                              {u.activo ? "Desactivar" : "Reactivar"}
                            </ConfirmButton>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Crear nuevo usuario">
        <NuevoUsuarioForm />
      </Panel>
    </div>
  );
}
