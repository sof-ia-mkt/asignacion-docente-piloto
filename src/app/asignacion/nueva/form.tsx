"use client";
import { useActionState } from "react";
import { crearSlot, type CrearSlotState } from "@/app/actions";

const input = "w-full px-3 py-2 rounded-md border border-slate-300 text-sm";
const label = "block text-sm font-medium text-slate-700 mb-1";

const TIPOS = ["DISCIPLINAR", "MÓDULO 1", "MÓDULO 2", "MÓDULO 3", "VIRTUAL"];
const MODALIDADES = ["PRESENCIAL", "ASINCRÓNICA"];
const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO", "N/A"];
const CUATRIS = ["1°", "2°", "3°", "4°", "5°", "6°", "7°", "8°", "9°"];

export function NuevaMateriaForm({
  planteles,
  materias,
  grupos,
}: {
  planteles: { plantel: string }[];
  materias: { id: number; nombre: string }[];
  grupos: { id: number; clave: string }[];
}) {
  const [state, action, pending] = useActionState<CrearSlotState, FormData>(crearSlot, {});

  // Aviso suave (no bloquea): una clase PRESENCIAL sin horario casi siempre es un olvido.
  // Las virtuales/asincrónicas no tienen hora fija, así que ahí no preguntamos.
  function avisarSiFaltaHorario(e: React.FormEvent<HTMLFormElement>) {
    const f = e.currentTarget;
    const modalidad = (f.elements.namedItem("modalidad") as HTMLSelectElement)?.value;
    const horaInicio = (f.elements.namedItem("hora_inicio") as HTMLInputElement)?.value.trim();
    if (modalidad === "PRESENCIAL" && !horaInicio) {
      if (!window.confirm("Es una clase PRESENCIAL sin horario. Lo normal es que tenga hora. ¿Crearla así de todos modos?")) {
        e.preventDefault();
      }
    }
  }

  return (
    <form action={action} onSubmit={avisarSiFaltaHorario} className="space-y-5 max-w-2xl">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={label}>Plantel *</label>
          <select name="plantel" required defaultValue="" className={input}>
            <option value="" disabled>Elige un plantel…</option>
            {planteles.map((p) => <option key={p.plantel} value={p.plantel}>{p.plantel}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Tipo de clase</label>
          <select name="tipo" defaultValue="DISCIPLINAR" className={input}>
            {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className={label}>Materia *</label>
          <input name="materia" required list="materias-list" className={input}
            placeholder="Escribe el nombre. Si ya existe, se reutiliza; si no, se crea." />
          <datalist id="materias-list">
            {materias.map((m) => <option key={m.id} value={m.nombre} />)}
          </datalist>
        </div>

        <div>
          <label className={label}>Grupo <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input name="grupo" list="grupos-list" className={input} placeholder="Ej. MEC_G19_DM_CB — o déjalo vacío" />
          <datalist id="grupos-list">
            {grupos.map((g) => <option key={g.id} value={g.clave} />)}
          </datalist>
        </div>
        <div>
          <label className={label}>Cuatrimestre *</label>
          <select name="cuatrimestre" required defaultValue="" className={input}>
            <option value="" disabled>Elige el cuatrimestre…</option>
            {CUATRIS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className={label}>Modalidad</label>
          <select name="modalidad" defaultValue="PRESENCIAL" className={input}>
            {MODALIDADES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Día <span className="text-slate-400 font-normal">(opcional)</span></label>
          <select name="dia" defaultValue="" className={input}>
            <option value="">— sin día —</option>
            {DIAS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div>
          <label className={label}>Hora inicio <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input name="hora_inicio" className={input} placeholder="07:00" />
        </div>
        <div>
          <label className={label}>Hora fin <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input name="hora_fin" className={input} placeholder="09:00" />
        </div>
      </div>

      {state.error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{state.error}</p>
      )}

      <button disabled={pending} className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">
        {pending ? "Creando…" : "Crear materia por grupo"}
      </button>
    </form>
  );
}
