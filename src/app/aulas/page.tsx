import { getAulas } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";
import { editarAula, eliminarAula } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";
import { ExportButtons } from "@/lib/export-buttons";
import { CrearAulaForm } from "./crear-form";

export default async function AulasPage() {
  const { aulas, resumen } = await getAulas();
  const teoria = aulas.filter((a) => a.tipo === "Teoría");
  const practica = aulas.filter((a) => a.tipo === "Práctica");
  const otras = aulas.filter((a) => a.tipo !== "Teoría" && a.tipo !== "Práctica");
  // Tipos ya existentes, para el datalist del alta (sugerencias sin obligar).
  const tipos = [...new Set(aulas.map((a) => a.tipo).filter((t): t is string => !!t))].sort();

  const cell = "px-2 py-1.5 rounded-md border border-slate-300 text-sm";

  // Cada fila es un mini-formulario (server action): editar tipo/capacidad sin recargar lógica de cliente.
  const Tabla = ({ titulo, lista }: { titulo: string; lista: typeof aulas }) => (
    <Panel title={`${titulo} (${lista.length})`}>
      {lista.length === 0 ? (
        <p className="text-sm text-slate-400">Sin aulas.</p>
      ) : (
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
            {lista.map((a) => (
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
      )}
    </Panel>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Aulas</h1>
          <p className="text-sm text-slate-500">Catálogo de salones del plantel. Edita tipo y capacidad, o agrega y borra salones.</p>
        </div>
        <ExportButtons tipo="aulas" className="shrink-0" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Aulas totales" value={aulas.length} />
        <Card title="De teoría" value={teoria.length} />
        <Card title="De práctica / labs" value={practica.length} />
        <Card title="Grupo más grande" value={resumen.alumnos_max} hint="alumnos" />
      </div>

      <Panel title="Agregar un salón">
        <CrearAulaForm tipos={tipos} />
      </Panel>

      <Panel>
        <p className="text-sm text-slate-600">
          El aula de teoría más grande es de <b>{resumen.cap_teoria}</b> y la de práctica de <b>{resumen.cap_practica}</b>.
          El grupo más numeroso tiene <b>{resumen.alumnos_max}</b> alumnos, así que el cupo alcanza:
          la plataforma podrá <b>recomendar el aula</b> cruzando alumnos contra capacidad y tipo de clase.
        </p>
      </Panel>

      {resumen.sin_capacidad > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>{resumen.sin_capacidad} aula{resumen.sin_capacidad === 1 ? "" : "s"} sin capacidad registrada.</b>{" "}
          El acomodo automático de salones las <b>ignora</b> (no sabe cuántos alumnos caben) y no cuentan
          para el aula más grande. Captura su capacidad abajo (filas en ámbar) para que la plataforma pueda usarlas.
        </div>
      )}

      {/* Datalist compartido para los selects de tipo en las filas editables. */}
      <datalist id="tipos-aula-edit">{tipos.map((t) => <option key={t} value={t} />)}</datalist>

      <div className="grid md:grid-cols-2 gap-4">
        <Tabla titulo="Aulas de teoría" lista={teoria} />
        <Tabla titulo="Aulas de práctica / laboratorios" lista={practica} />
      </div>
      {otras.length > 0 && <Tabla titulo="Otras" lista={otras} />}
    </div>
  );
}
