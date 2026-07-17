"use client";
import { useActionState, useState } from "react";
import { crearSlot, type CrearSlotState } from "@/app/actions";
import { NuevoGrupo, type DatosNuevoGrupo } from "./nuevo-grupo";

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
  datosGrupo,
}: {
  planteles: { plantel: string }[];
  materias: { id: number; nombre: string }[];
  grupos: { id: number; clave: string }[];
  datosGrupo: DatosNuevoGrupo;
}) {
  const [state, action, pending] = useActionState<CrearSlotState, FormData>(crearSlot, {});
  // El grupo se elige del catálogo (select estricto, ya no se teclea la clave). Si el grupo
  // no existe, el constructor de abajo lo crea y aquí queda seleccionado automáticamente.
  const [listaGrupos, setListaGrupos] = useState(grupos);
  const [grupoSel, setGrupoSel] = useState("");
  const [creandoGrupo, setCreandoGrupo] = useState(false);
  // Regla de los datos (sin excepciones): VIRTUAL ⇔ ASINCRÓNICA; el resto, PRESENCIAL.
  // Al cambiar el tipo, la modalidad se acomoda sola para no capturar combinaciones imposibles.
  const [tipoSel, setTipoSel] = useState("DISCIPLINAR");
  const [modalidadSel, setModalidadSel] = useState("PRESENCIAL");
  const cambiarTipo = (t: string) => {
    setTipoSel(t);
    if (t === "VIRTUAL") setModalidadSel("ASINCRÓNICA");
    else if (modalidadSel === "ASINCRÓNICA") setModalidadSel("PRESENCIAL");
  };

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
          <select name="tipo" value={tipoSel} onChange={(e) => cambiarTipo(e.target.value)} className={input}>
            {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {tipoSel === "VIRTUAL" && (
            <p className="mt-1 text-xs text-slate-400">
              Las virtuales son asincrónicas y sin horario (así están todas las demás): la modalidad se ajustó sola.
            </p>
          )}
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
          <div className="flex gap-2">
            <select name="grupo_id" value={grupoSel} onChange={(e) => setGrupoSel(e.target.value)} className={input}>
              <option value="">— sin grupo —</option>
              {listaGrupos.map((g) => <option key={g.id} value={g.id}>{g.clave}</option>)}
            </select>
            <button type="button" onClick={() => setCreandoGrupo((v) => !v)}
              className="shrink-0 px-3 py-2 rounded-md border border-blue-300 bg-blue-50 text-sm text-blue-800 hover:bg-blue-100 whitespace-nowrap">
              {creandoGrupo ? "Cerrar" : "+ Nuevo grupo"}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Solo grupos del catálogo (la clave ya no se teclea, para evitar errores de dedo).
            ¿No existe todavía? Créalo con «+ Nuevo grupo»: la clave se arma sola.
          </p>
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
          <select name="modalidad" value={modalidadSel} onChange={(e) => setModalidadSel(e.target.value)} className={input}>
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

      {/* Constructor de grupo: crea la clave por partes y la deja seleccionada arriba. */}
      {creandoGrupo && (
        <NuevoGrupo
          datos={datosGrupo}
          onCreado={(g) => {
            setListaGrupos((prev) => [...prev, g].sort((a, b) => a.clave.localeCompare(b.clave)));
            setGrupoSel(String(g.id));
            setCreandoGrupo(false);
          }}
          onCancelar={() => setCreandoGrupo(false)}
        />
      )}

      {state.error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{state.error}</p>
      )}

      <button disabled={pending} className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50">
        {pending ? "Creando…" : "Crear materia por grupo"}
      </button>
    </form>
  );
}
