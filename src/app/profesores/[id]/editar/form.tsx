"use client";
import { useActionState } from "react";
import { editarDocente, type EditarDocenteState } from "@/app/actions";
import { COORDINADORES } from "@/lib/ui";

const input = "w-full px-3 py-2 rounded-md border border-slate-300 text-sm";
const label = "block text-sm font-medium text-slate-700 mb-1";

type Datos = {
  id: number;
  nombre: string;
  licenciatura: string | null;
  maestria: string | null;
  doctorado: string | null;
  anios_experiencia: number | null;
  coordinador: string | null;
  correo: string | null;
};

export function EditarDocenteForm({ prof }: { prof: Datos }) {
  // bind del id: la acción queda como (prev, fd) que es lo que espera useActionState.
  const action = editarDocente.bind(null, prof.id);
  const [state, formAction, pending] = useActionState<EditarDocenteState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-5 max-w-2xl">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={label}>Nombre completo *</label>
          <input name="nombre" required defaultValue={prof.nombre} className={input} />
        </div>
        <div>
          <label className={label}>Años de experiencia *</label>
          <input name="anios_experiencia" required type="number" min="0"
            defaultValue={prof.anios_experiencia ?? ""} className={input} />
        </div>
        <div className="md:col-span-2">
          <label className={label}>Licenciatura *</label>
          <input name="licenciatura" required defaultValue={prof.licenciatura ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Maestría <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input name="maestria" defaultValue={prof.maestria ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Doctorado <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input name="doctorado" defaultValue={prof.doctorado ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Coordinación académica * <span className="text-slate-400 font-normal">— quién lo va a asignar</span></label>
          <select name="coordinador" required defaultValue={prof.coordinador ?? ""} className={input}>
            <option value="" disabled>— Selecciona —</option>
            {COORDINADORES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Correo del docente <span className="text-slate-400 font-normal">(para enviarle su propuesta)</span></label>
          <input name="correo" type="email" defaultValue={prof.correo ?? ""} className={input}
            placeholder="nombre@dominio.com" />
        </div>
      </div>

      {state.error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{state.error}</p>
      )}

      <button disabled={pending} className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">
        {pending ? "Guardando…" : "Guardar cambios"}
      </button>
    </form>
  );
}
