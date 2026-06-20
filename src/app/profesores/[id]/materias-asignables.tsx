"use client";
import { useState } from "react";
import { asignar } from "@/app/actions";
import { TipoClase, plantelCorto } from "@/lib/ui";
import { ConfirmButton } from "@/lib/confirm-button";

// Un grupo (slot) de septiembre todavía SIN docente, de una materia que este profesor puede dar.
export type GrupoAbierto = {
  slot_id: number; grupo: string | null; plantel: string | null;
  dia: string | null; hora_inicio: string | null; hora_fin: string | null;
  tipo: string | null; modalidad: string | null; choque: string | null;
};
// Una materia candidata con sus grupos abiertos y el contexto para asignar (puntaje/razón).
export type MateriaReco = {
  materia_id: number; materia: string; puntaje: number; razon: string;
  yaLaDa: boolean; grupos: GrupoAbierto[];
};

const horario = (g: GrupoAbierto) =>
  g.dia ? `${g.dia} ${g.hora_inicio ?? "—"}–${g.hora_fin ?? "—"}` : "Sin horario";

export function MateriasAsignables({
  impartio, cvFuerte, afinidad, profesorId, nombre, disponibles,
}: {
  impartio: MateriaReco[]; cvFuerte: MateriaReco[]; afinidad: MateriaReco[];
  profesorId: number; nombre: string; disponibles: number;
}) {
  // materia_id actualmente desplegada (sus grupos abiertos visibles abajo). null = ninguna.
  const [abierta, setAbierta] = useState<number | null>(null);
  const todas = [...impartio, ...cvFuerte, ...afinidad];
  const sel = todas.find((m) => m.materia_id === abierta) ?? null;

  // Pastilla de una materia. ✓ = ya la tiene asignada (atenuada, no se vuelve a asignar).
  // Disponible con grupos abiertos = clic para desplegar y asignar. Sin grupos = atenuada.
  const chip = (c: MateriaReco) => {
    const activa = c.materia_id === abierta;
    const tieneGrupos = c.grupos.length > 0;
    if (c.yaLaDa) {
      return (
        <span key={c.materia_id} title={`${c.razon ? c.razon + " · " : ""}puntaje ${c.puntaje} · ya asignada`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border bg-slate-100 text-slate-400 border-slate-200">
          <span className="text-green-600 text-xs">✓</span>{c.materia}
        </span>
      );
    }
    if (!tieneGrupos) {
      return (
        <span key={c.materia_id} title="No hay grupos abiertos de esta materia por ahora (todos asignados o sin grupo este ciclo)."
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border bg-white text-slate-400 border-slate-200">
          {c.materia} <span className="text-[11px] text-slate-300">sin grupos</span>
        </span>
      );
    }
    return (
      <button key={c.materia_id} type="button"
        onClick={() => setAbierta(activa ? null : c.materia_id)}
        title={`${c.razon ? c.razon + " · " : ""}puntaje ${c.puntaje} · clic para ver grupos abiertos`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border transition-colors ${
          activa
            ? "bg-blue-600 text-white border-blue-600"
            : "bg-white text-slate-700 border-blue-300 hover:bg-blue-50"}`}>
        {c.materia}
        <span className={`text-[11px] rounded-full px-1.5 ${activa ? "bg-blue-500" : "bg-blue-100 text-blue-700"}`}>
          {c.grupos.length}
        </span>
      </button>
    );
  };

  const grupo = (c: MateriaReco, g: GrupoAbierto) => {
    const asignarBind = asignar.bind(null, g.slot_id, profesorId, c.puntaje, c.razon);
    return (
      <div key={g.slot_id}
        className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${g.choque ? "bg-red-50/50" : ""}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TipoClase t={g.tipo} />
            <span className="text-slate-700">{g.grupo ?? "Sin grupo"}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 whitespace-nowrap">{plantelCorto(g.plantel)}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 whitespace-nowrap">{horario(g)}</span>
          </div>
          {g.choque && (
            <p className="mt-0.5 text-xs font-medium text-red-700">
              Choca: ya tiene «{g.choque}» a esa hora — lo empalmarías.
            </p>
          )}
        </div>
        <form action={asignarBind} className="shrink-0">
          {g.choque ? (
            <ConfirmButton
              message={`«${g.choque}» se encima con esta clase a la misma hora. Si asignas a ${nombre} aquí, quedará con un choque de horario. ¿Asignar de todos modos?`}
              className="px-3 py-1.5 rounded-md border border-red-300 bg-white text-red-700 text-xs hover:bg-red-50 whitespace-nowrap">
              Asignar de todos modos
            </ConfirmButton>
          ) : (
            <button type="submit"
              className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs hover:bg-slate-800 whitespace-nowrap">
              Asignar aquí
            </button>
          )}
        </form>
      </div>
    );
  };

  const todasVacias = impartio.length + cvFuerte.length + afinidad.length === 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Materias que puede dar</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Ordenadas por qué tan fuerte es la señal{disponibles > 0 ? ` · ${disponibles} disponible${disponibles === 1 ? "" : "s"} para asignar` : ""}.
          {" "}<span className="text-green-600">✓</span> = ya la tiene asignada · <span className="text-blue-700">clic en una materia</span> para ver sus grupos abiertos y asignarlo ahí mismo.
        </p>
      </div>

      {todasVacias ? (
        <p className="text-sm text-slate-400">Sin recomendaciones.</p>
      ) : (
        <>
          {impartio.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">
                Ya las impartió <span className="font-normal text-slate-400">({impartio.length}) · la señal más fuerte</span>
              </div>
              <div className="flex flex-wrap gap-2">{impartio.map(chip)}</div>
            </div>
          )}

          {cvFuerte.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">
                Sugeridas por su CV <span className="font-normal text-slate-400">({cvFuerte.length}) · buena afinidad</span>
              </div>
              <div className="flex flex-wrap gap-2">{cvFuerte.map(chip)}</div>
            </div>
          )}

          {afinidad.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-700">
                Otras posibles por afinidad <span className="font-normal text-slate-400">({afinidad.length}) · señal débil — clic para ver</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">{afinidad.map(chip)}</div>
            </details>
          )}
        </>
      )}

      {/* Panel de grupos abiertos de la materia seleccionada: aparece abajo para no romper el acomodo. */}
      {sel && sel.grupos.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/40">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-blue-100">
            <div className="text-sm">
              <span className="font-medium text-slate-800">{sel.materia}</span>
              <span className="text-slate-500"> · {sel.grupos.length} grupo{sel.grupos.length === 1 ? "" : "s"} sin docente</span>
            </div>
            <button type="button" onClick={() => setAbierta(null)}
              className="text-xs text-slate-500 hover:text-slate-700">Cerrar ✕</button>
          </div>
          <div className="divide-y divide-blue-100">{sel.grupos.map((g) => grupo(sel, g))}</div>
          <p className="px-3 py-2 text-[11px] text-slate-400">
            Al asignar queda como decisión de coordinación (Asignada). Las clases en
            <span className="text-red-700"> rojo</span> chocan con otra que ya tiene a esa hora.
          </p>
        </div>
      )}
    </div>
  );
}
