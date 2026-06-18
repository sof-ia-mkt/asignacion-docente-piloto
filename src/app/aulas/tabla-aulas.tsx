"use client";
// Tabla de aulas (por tipo) con "mostrar de a poco": evita el scroll largo cuando
// hay muchos salones (p. ej. 63 de teoría). Cada fila sigue siendo un mini-formulario
// con server actions (editar tipo/capacidad, borrar) — eso no cambia, solo limitamos
// cuántas filas se pintan a la vez.
import { useState } from "react";
import { Panel } from "@/lib/ui";
import { editarAula, eliminarAula } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";

export type AulaFila = {
  id: number;
  clave: string;
  tipo: string | null;
  capacidad: number | null;
  en_uso: number;
};

const POR_PAGINA = 25;
const cell = "px-2 py-1.5 rounded-md border border-slate-300 text-sm";

export function TablaAulas({ titulo, lista }: { titulo: string; lista: AulaFila[] }) {
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const mostrados = lista.slice(0, visibles);
  const faltan = lista.length - mostrados.length;

  return (
    <Panel title={`${titulo} (${lista.length})`}>
      {lista.length === 0 ? (
        <p className="text-sm text-slate-400">Sin aulas.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="py-1 font-medium">Aula</th>
                <th className="py-1 font-medium">Tipo</th>
                <th className="py-1 font-medium">Capacidad</th>
                <th className="py-1 font-medium">Uso</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mostrados.map((a) => (
                <tr key={a.id} className={a.capacidad == null ? "bg-amber-50/60" : ""}>
                  <td className="py-1.5 pr-3 text-slate-800 break-words">{a.clave}</td>
                  <td className="py-1.5 pr-2" colSpan={2}>
                    <form action={editarAula.bind(null, a.id)} className="flex flex-wrap items-center gap-1">
                      <input name="tipo" defaultValue={a.tipo ?? ""} list="tipos-aula-edit"
                        placeholder="—" className={cell + " w-28"} />
                      <input name="capacidad" type="number" min="1" defaultValue={a.capacidad ?? ""}
                        placeholder="s/cap" className={cell + " w-20"} />
                      <button className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 text-xs hover:bg-slate-200">
                        Guardar
                      </button>
                    </form>
                  </td>
                  <td className="py-1.5 pr-2 text-slate-500 whitespace-nowrap">
                    {a.en_uso > 0 ? `${a.en_uso} clase${a.en_uso === 1 ? "" : "s"}` : "libre"}
                  </td>
                  <td className="py-1.5 text-right">
                    {a.en_uso === 0 ? (
                      <form action={eliminarAula.bind(null, a.id)}>
                        <ConfirmButton
                          message={`¿Borrar el salón "${a.clave}"? No lo usa ninguna clase. Esto NO se puede deshacer.`}
                          className="text-red-600 hover:underline text-xs">
                          Borrar
                        </ConfirmButton>
                      </form>
                    ) : (
                      <span className="text-xs text-slate-300 whitespace-nowrap" title="En uso por clases asignadas">en uso</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {faltan > 0 && (
            <div className="mt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setVisibles((v) => v + POR_PAGINA)}
                className="px-4 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
              >
                Mostrar más ({Math.min(POR_PAGINA, faltan)} de {faltan} restantes)
              </button>
              {lista.length > POR_PAGINA && (
                <button
                  type="button"
                  onClick={() => setVisibles(lista.length)}
                  className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Ver todas ({lista.length})
                </button>
              )}
            </div>
          )}
          {faltan === 0 && lista.length > POR_PAGINA && (
            <p className="mt-3 text-center text-xs text-slate-400">
              Mostrando las {lista.length}.{" "}
              <button
                type="button"
                onClick={() => setVisibles(POR_PAGINA)}
                className="text-slate-500 hover:text-slate-700 hover:underline"
              >
                Volver a {POR_PAGINA}
              </button>
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
