"use client";
// Edición inline desde la lista de asignación: materia y tipo de cada clase.
// Regla anti-typo: aquí NUNCA se escribe texto libre — todo es selección de catálogo.
//   - Materia: select estricto sobre las materias existentes (re-apunta la clase).
//   - Tipo: select fijo de los 5 tipos válidos.
//   - "Renombrar…" es la excepción controlada: corrige el nombre EN EL CATÁLOGO,
//     avisando primero a cuántas clases afecta (incluido el historial de mayo).
import { useState, useTransition } from "react";
import { editarMateriaSlot, editarTipoSlot, renombrarMateria, usoMateria } from "@/app/actions";
import { TipoClase } from "@/lib/ui";

const TIPOS = ["DISCIPLINAR", "MÓDULO 1", "MÓDULO 2", "MÓDULO 3", "VIRTUAL"];

const lapiz = "opacity-0 group-hover:opacity-100 shrink-0 px-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 text-xs";
const selectCss = "px-2 py-1 rounded-md border border-slate-300 text-sm bg-white max-w-[280px]";

export function CeldaMateria({
  slotId,
  materiaId,
  nombre,
  materias,
}: {
  slotId: number;
  materiaId: number | null;
  nombre: string | null;
  materias: { id: number; nombre: string }[];
}) {
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();

  // En los datos reales hay materias con nombre vacío (typo de origen): se señalan en ámbar
  // para que se vean y se corrijan aquí mismo (re-eligiendo o con "Renombrar…").
  const sinNombre = !nombre?.trim();

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span>{sinNombre ? <span className="text-amber-600">{materiaId == null ? "sin materia" : "materia sin nombre"}</span> : nombre}</span>
        <button
          title="Editar materia"
          onClick={(e) => { e.stopPropagation(); setEditando(true); }}
          className={lapiz}
        >✎</button>
      </span>
    );
  }

  // El renombrado avisa primero el alcance real (N clases en todos los ciclos) y luego
  // pide el nombre nuevo. El servidor normaliza y rechaza duplicados del catálogo.
  async function renombrar() {
    if (materiaId == null) return;
    const uso = await usoMateria(materiaId);
    const nuevo = window.prompt(
      `Renombrar la materia "${uso.nombre ?? nombre}" EN EL CATÁLOGO.\n\n` +
      `Esto cambia el nombre en las ${uso.clases} clases que la llevan (incluido el historial de ciclos pasados). ` +
      `Si solo esta clase debía llevar otra materia, cancela y elígela de la lista.\n\nNombre nuevo:`,
      uso.nombre ?? nombre ?? "",
    );
    if (nuevo == null) return;
    const r = await renombrarMateria(materiaId, nuevo);
    if (r.error) window.alert(r.error);
    else setEditando(false);
  }

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-2">
      <select
        autoFocus
        disabled={pending}
        // Si la materia actual no tiene nombre (se filtra de las opciones), arranca en el
        // placeholder: si no, el select caería en la primera opción real y elegirla no
        // dispararía onChange (no habría "cambio").
        defaultValue={sinNombre ? "" : materiaId ?? ""}
        onKeyDown={(e) => { if (e.key === "Escape") setEditando(false); }}
        onChange={(e) => {
          const id = Number(e.target.value);
          if (!id || id === materiaId) return;
          start(async () => {
            const r = await editarMateriaSlot(slotId, id);
            if (r.error) window.alert(r.error);
            setEditando(false);
          });
        }}
        className={selectCss}
      >
        <option value="" disabled>— elige materia —</option>
        {materias.filter((m) => m.nombre.trim()).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
      </select>
      {materiaId != null && (
        <button onClick={renombrar} disabled={pending} className="text-xs text-blue-700 hover:underline whitespace-nowrap">
          Renombrar…
        </button>
      )}
      <button onClick={() => setEditando(false)} title="Cancelar" className="text-xs text-slate-400 hover:text-slate-600">✕</button>
    </span>
  );
}

export function CeldaTipo({ slotId, tipo }: { slotId: number; tipo: string | null }) {
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <TipoClase t={tipo} />
        <button
          title="Editar tipo"
          onClick={(e) => { e.stopPropagation(); setEditando(true); }}
          className={lapiz}
        >✎</button>
      </span>
    );
  }

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-2">
      <select
        autoFocus
        disabled={pending}
        defaultValue={tipo ?? ""}
        onKeyDown={(e) => { if (e.key === "Escape") setEditando(false); }}
        onChange={(e) => {
          const t = e.target.value;
          if (!t || t === tipo) return;
          start(async () => {
            const r = await editarTipoSlot(slotId, t);
            if (r.error) window.alert(r.error);
            setEditando(false);
          });
        }}
        className={selectCss}
      >
        <option value="" disabled>— elige tipo —</option>
        {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={() => setEditando(false)} title="Cancelar" className="text-xs text-slate-400 hover:text-slate-600">✕</button>
    </span>
  );
}
