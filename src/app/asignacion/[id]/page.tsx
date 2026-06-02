import Link from "next/link";
import { notFound } from "next/navigation";
import { getSlot } from "@/lib/queries";
import { Estado } from "@/lib/ui";
import { asignar, confirmar, quitarAsignacion } from "@/app/actions";

export default async function SlotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slotId = Number(id);
  const data = await getSlot(slotId);
  if (!data) notFound();
  const { slot, candidatos } = data;

  return (
    <div className="space-y-5">
      <Link href="/asignacion" className="text-sm text-blue-700 hover:underline">← Asignación</Link>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{slot.materia ?? "—"}</h1>
            <p className="text-sm text-slate-500">
              Grupo {slot.grupo ?? "—"} · {slot.dia ? `${slot.dia} ${slot.hora_inicio}-${slot.hora_fin}` : "sin horario"}
              {slot.tipo ? ` · ${slot.tipo}` : ""}{slot.modalidad ? ` · ${slot.modalidad}` : ""}
            </p>
          </div>
          <Estado e={slot.estado} />
        </div>

        <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-500">Docente actual: </span>
          {slot.docente ? (
            <span className="font-medium text-slate-800">{slot.docente}</span>
          ) : (
            <span className="text-slate-400">sin asignar</span>
          )}
          {slot.razon && <p className="mt-1 text-xs text-slate-400">{slot.razon}</p>}
          {slot.docente && (
            <div className="mt-3 flex gap-2">
              {slot.estado === "sugerida" && (
                <form action={confirmar.bind(null, slotId)}>
                  <button className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm">Confirmar sugerencia</button>
                </form>
              )}
              <form action={quitarAsignacion.bind(null, slotId)}>
                <button className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">Quitar docente</button>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Candidatos recomendados</h2>
        {candidatos.length === 0 ? (
          <p className="text-sm text-slate-400">
            No hay candidatos fuertes para esta materia (ni historial ni CV con confianza alta).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="py-1 font-medium">Docente</th>
                <th className="py-1 font-medium">Fuente</th>
                <th className="py-1 font-medium text-right">Puntaje</th>
                <th className="py-1 font-medium text-right">Carga</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {candidatos.map((c) => (
                <tr key={c.profesor_id} className={slot.docente_id === c.profesor_id ? "bg-blue-50" : ""}>
                  <td className="py-1.5 pr-2">
                    <Link href={`/profesores/${c.profesor_id}`} className="text-blue-700 hover:underline">{c.nombre}</Link>
                  </td>
                  <td className="py-1.5 pr-2 text-slate-600">{c.fuentes}</td>
                  <td className="py-1.5 pr-2 text-right font-medium">{c.puntaje}</td>
                  <td className="py-1.5 pr-2 text-right text-slate-600">{c.carga}</td>
                  <td className="py-1.5 text-right">
                    {slot.docente_id === c.profesor_id ? (
                      <span className="text-xs text-slate-400">asignado</span>
                    ) : (
                      <form action={asignar.bind(null, slotId, c.profesor_id, c.puntaje, c.razon)}>
                        <button className="px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs">Asignar</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-slate-400">
          La carga es el número de slots ya asignados a ese docente en septiembre. Evita asignar a alguien sobrecargado o con choque de horario.
        </p>
      </div>
    </div>
  );
}
