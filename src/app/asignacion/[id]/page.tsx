import Link from "next/link";
import { notFound } from "next/navigation";
import { getSlot, buscarProfesores } from "@/lib/queries";
import { Estado, TipoClase, planCorto, plantelCorto, PlantelBadge } from "@/lib/ui";
import { asignar, confirmar, quitarAsignacion, asignarAula, quitarAula, editarHorario, eliminarSlot } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";

const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO", "N/A"];

export default async function SlotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ buscar?: string }>;
}) {
  const { id } = await params;
  const buscar = (await searchParams).buscar ?? "";
  const slotId = Number(id);
  const data = await getSlot(slotId);
  if (!data) notFound();
  const { slot, candidatos, aulas } = data;
  const manuales = await buscarProfesores(buscar, slot.materia_id);
  const esPresencial = (slot.modalidad ?? "").toUpperCase() === "PRESENCIAL";
  const aulaChica = slot.aula_capacidad != null && slot.alumnos != null && slot.aula_capacidad < slot.alumnos;

  return (
    <div className="space-y-5">
      <Link href="/asignacion" className="text-sm text-blue-700 hover:underline">← Asignación</Link>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{slot.materia ?? "—"}</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              {planCorto(slot.plan)}{slot.cuatrimestre ? ` · ${slot.cuatrimestre} cuatrimestre` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <TipoClase t={slot.tipo} />
              {slot.modalidad && <span>{slot.modalidad}</span>}
              {slot.plantel && <span className="font-medium text-slate-700">{plantelCorto(slot.plantel)}</span>}
              <span>Grupo {slot.grupo ?? "—"}</span>
              {slot.alumnos != null && <span>{slot.alumnos} alumnos</span>}
              <span>{slot.dia ? `${slot.dia} ${slot.hora_inicio}-${slot.hora_fin}` : "sin horario"}</span>
            </div>
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
              <form action={quitarAsignacion.bind(null, slotId, slot.docente_id ?? undefined)}>
                <ConfirmButton
                  message="¿Quitar el docente de esta clase? Quedará sin maestro (libre para reasignar)."
                  className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">
                  Quitar docente
                </ConfirmButton>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">Día y horario</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Corrige o completa el horario de esta materia. Muchas vienen sin horario del Excel.
        </p>
        <form action={editarHorario.bind(null, slotId)} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Día</label>
            <select name="dia" defaultValue={slot.dia ?? ""} className="px-3 py-1.5 rounded-md border border-slate-300 text-sm">
              <option value="">— sin día —</option>
              {DIAS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Hora inicio</label>
            <input name="hora_inicio" defaultValue={slot.hora_inicio ?? ""} placeholder="07:00"
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm w-24" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Hora fin</label>
            <input name="hora_fin" defaultValue={slot.hora_fin ?? ""} placeholder="09:00"
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm w-24" />
          </div>
          <button className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm">Guardar horario</button>
        </form>
        <p className="mt-2 text-xs text-slate-400">Formato de hora: HH:MM (24h). Déjalo vacío si aún no hay horario.</p>
      </div>

      {esPresencial && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-slate-700">Aula</h2>
            <div className="text-sm">
              {slot.aula ? (
                <span className={aulaChica ? "text-red-700 font-medium" : "text-slate-800 font-medium"}>
                  {slot.aula}
                  {slot.aula_capacidad != null && (
                    <span className="font-normal text-slate-500"> · cap. {slot.aula_capacidad}{slot.alumnos != null ? ` / ${slot.alumnos} alumnos` : ""}</span>
                  )}
                </span>
              ) : (
                <span className="text-slate-400">sin aula</span>
              )}
            </div>
          </div>
          {aulaChica && (
            <p className="mt-1 text-xs text-red-600">El aula no alcanza para el grupo ({slot.alumnos} alumnos).</p>
          )}

          <div className="mt-3 border-t border-slate-100 pt-3">
            {aulas.length === 0 ? (
              <p className="text-sm text-slate-400">No hay aulas con cupo para este grupo.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-left">
                  <tr>
                    <th className="py-1 font-medium">Aula</th>
                    <th className="py-1 font-medium">Tipo</th>
                    <th className="py-1 font-medium text-right">Cap.</th>
                    <th className="py-1 font-medium">Disponibilidad</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {aulas.map((au) => (
                    <tr key={au.id} className={slot.aula_id === au.id ? "bg-blue-50" : ""}>
                      <td className="py-1.5 pr-2 text-slate-800">{au.clave}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{au.tipo ?? "—"}</td>
                      <td className="py-1.5 pr-2 text-right text-slate-600">{au.capacidad ?? "—"}</td>
                      <td className="py-1.5 pr-2">
                        {au.ocupada
                          ? <span className="text-amber-700">ocupada a esa hora</span>
                          : <span className="text-green-700">libre</span>}
                      </td>
                      <td className="py-1.5 text-right">
                        {slot.aula_id === au.id ? (
                          <form action={quitarAula.bind(null, slotId)}>
                            <button className="px-2.5 py-1 rounded-md border border-slate-200 text-slate-700 text-xs hover:bg-slate-50">Quitar</button>
                          </form>
                        ) : (
                          <form action={asignarAula.bind(null, slotId, au.id)}>
                            <button className="px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs">Asignar</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

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
                <th className="py-1 font-medium">Plantel</th>
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
                  <td className="py-1.5 pr-2">
                    <PlantelBadge planteles={c.hist_planteles ? c.hist_planteles.split(",") : []} destino={slot.plantel} />
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
          La carga es el número de materias ya asignadas a ese docente en septiembre. Evita asignar a alguien sobrecargado o con choque de horario.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">Asignar manualmente</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          ¿No hay candidato fuerte, o quieres poner a alguien más? Busca a cualquier docente y asígnalo a mano.
          {" "}¿Falta el docente? <Link href="/profesores/nuevo" className="text-blue-700 hover:underline">Da de alta uno nuevo</Link>.
        </p>

        <form className="mt-3 flex gap-2">
          <input name="buscar" defaultValue={buscar} placeholder="Buscar docente por nombre o área…"
            className="px-3 py-1.5 rounded-md border border-slate-200 text-sm flex-1" />
          <button className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm">Buscar</button>
        </form>

        <div className="mt-3 border-t border-slate-100 pt-3">
          {manuales.length === 0 ? (
            <p className="text-sm text-slate-400">
              {buscar ? `Sin docentes que coincidan con "${buscar}".` : "No hay docentes registrados."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-left">
                <tr>
                  <th className="py-1 font-medium">Docente</th>
                  <th className="py-1 font-medium">Área</th>
                  <th className="py-1 font-medium text-right">Carga</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {manuales.map((p) => (
                  <tr key={p.id} className={slot.docente_id === p.id ? "bg-blue-50" : ""}>
                    <td className="py-1.5 pr-2">
                      <Link href={`/profesores/${p.id}`} className="text-blue-700 hover:underline">{p.nombre}</Link>
                      {p.recomendado && <span className="ml-2 text-xs text-slate-400">(ya recomendado)</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">{p.area_cv ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right text-slate-600">{p.carga}</td>
                    <td className="py-1.5 text-right">
                      {slot.docente_id === p.id ? (
                        <span className="text-xs text-slate-400">asignado</span>
                      ) : (
                        <form action={asignar.bind(null, slotId, p.id, 0, "Asignación manual por coordinación")}>
                          <button className="px-2.5 py-1 rounded-md border border-slate-300 text-slate-700 text-xs hover:bg-slate-50">Asignar a mano</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-slate-400">
            La asignación manual no usa el historial ni el CV: queda registrada como decisión de coordinación (puntaje 0). El motor de recomendación no la sobreescribe.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-red-800">Eliminar esta materia por grupo</h2>
            <p className="mt-0.5 text-xs text-red-600">
              Úsalo si esta materia no se va a abrir (ej. &quot;NO SE APERTURA&quot;). Se borra junto con su asignación y alertas. No se puede deshacer.
            </p>
          </div>
          <form action={eliminarSlot.bind(null, slotId)}>
            <ConfirmButton
              message="¿Eliminar esta clase del cuatrimestre? Se borra junto con su asignación y alertas. No se puede deshacer."
              className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm whitespace-nowrap">
              Eliminar
            </ConfirmButton>
          </form>
        </div>
      </div>
    </div>
  );
}
