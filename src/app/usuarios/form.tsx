"use client";
import { useActionState } from "react";
import { crearUsuarioAccion, type CrearUsuarioState } from "./actions";

const input = "w-full px-3 py-2 rounded-md border border-slate-300 text-sm";
const label = "block text-sm font-medium text-slate-700 mb-1";

export function NuevoUsuarioForm() {
  const [state, action, pending] = useActionState<CrearUsuarioState, FormData>(crearUsuarioAccion, {});
  return (
    <form action={action} className="grid md:grid-cols-2 gap-4">
      <div>
        <label className={label}>Nombre completo *</label>
        <input name="nombre" required className={input} placeholder="Ej. Juan Pérez" />
      </div>
      <div>
        <label className={label}>Usuario (login) *</label>
        <input name="usuario" required className={input} placeholder="nombre.apellido" pattern="[a-z0-9.]+" />
      </div>
      <div>
        <label className={label}>Correo <span className="text-slate-400 font-normal">(opcional)</span></label>
        <input name="correo" type="email" className={input} placeholder="correo@cenyca.edu.mx" />
      </div>
      <div>
        <label className={label}>Coordinación</label>
        <select name="rol" defaultValue="" className={input}>
          <option value="">Sin coordinación (solo admin)</option>
          <option value="academica">Académica</option>
          <option value="carrera">De carrera</option>
          <option value="direccion_general">Dirección General (acceso total)</option>
        </select>
      </div>
      <div>
        <label className={label}>Carrera <span className="text-slate-400 font-normal">(si es de carrera)</span></label>
        <input name="carrera" className={input} placeholder="Ej. Gastronomía" />
      </div>
      <div className="flex items-end">
        <label className="flex items-center gap-2 text-sm text-slate-700 pb-2">
          <input type="checkbox" name="es_admin" /> Es administrador
        </label>
      </div>

      <div className="md:col-span-2 flex items-center gap-3">
        <button disabled={pending} className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">
          {pending ? "Creando…" : "Crear usuario"}
        </button>
        <span className="text-xs text-slate-400">Se crea con la contraseña temporal compartida.</span>
      </div>

      {state.error && (
        <p className="md:col-span-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{state.error}</p>
      )}
      {state.ok && (
        <p className="md:col-span-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">{state.ok}</p>
      )}
    </form>
  );
}
