// Propuesta Académica (PDF por docente).
// /imprimir/propuesta/<id>  ->  documento limpio con membrete (logo + CENYCA),
// la tabla de materias/horarios que el docente impartirá en septiembre y los totales
// (materias + horas/semana). Coordinación lo descarga ("Guardar como PDF") y lo envía por
// correo. La app NO manda correo: solo genera el documento imprimible.

import { notFound } from "next/navigation";
import { getPropuestaProfesor } from "@/lib/queries";
import { cicloLabel, plantelCorto } from "@/lib/ui";
import { PrintToolbar } from "../../[tipo]/print-toolbar";

export default async function PropuestaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getPropuestaProfesor(Number(id));
  if (!data) notFound();
  const { prof, clases, horasPorModulo, totales, ciclo } = data;

  const fecha = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
  const horario = (c: (typeof clases)[number]) =>
    c.dia ? `${c.dia} ${c.hora_inicio ?? ""}–${c.hora_fin ?? ""}`.trim() : "En línea (sin hora fija)";

  return (
    <div className="print-root">
      <PrintToolbar />

      {/* Membrete institucional */}
      <header className="mb-6 border-b border-slate-300 pb-4">
        <div className="flex items-center justify-between gap-4">
          {/* Logo en versión oscura (el original es blanco, invisible en papel). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-cenyca-dark.png" alt="CENYCA" className="h-12 w-auto" />
          <div className="text-right text-xs text-slate-500 leading-tight">
            <div className="font-semibold text-slate-700">CENYCA</div>
            <div>Coordinación Académica</div>
            <div>Generado el {fecha}</div>
          </div>
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Propuesta Académica</h1>
        <p className="text-sm text-slate-600">
          {cicloLabel(ciclo)}{ciclo ? ` · Ciclo ${ciclo}` : ""}
        </p>
      </header>

      {/* Datos del docente */}
      <section className="mb-5">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="sm:col-span-1">
            <dt className="text-xs uppercase tracking-wide text-slate-400">Docente</dt>
            <dd className="text-base font-semibold text-slate-900">{prof.nombre}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Licenciatura</dt>
            <dd className="text-slate-700">{prof.licenciatura ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Coordinación</dt>
            <dd className="text-slate-700">{prof.coordinador ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* Resumen de carga */}
      <section className="mb-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-300 px-4 py-3">
          <div className="text-2xl font-semibold text-slate-900">{totales.materias}</div>
          <div className="text-xs text-slate-500">Materias propuestas</div>
        </div>
        <div className="rounded-lg border border-slate-300 px-4 py-3">
          <div className="text-2xl font-semibold text-slate-900">{totales.horasSemana}</div>
          <div className="text-xs text-slate-500">Horas/semana (clases con horario)</div>
        </div>
        {totales.sinHorario > 0 && (
          <div className="rounded-lg border border-slate-300 px-4 py-3">
            <div className="text-2xl font-semibold text-slate-900">{totales.sinHorario}</div>
            <div className="text-xs text-slate-500">En línea (sin hora fija)</div>
          </div>
        )}
      </section>

      {/* Tabla de materias */}
      <section className="mb-6">
        {clases.length === 0 ? (
          <p className="text-sm text-slate-400">Este docente todavía no tiene materias propuestas para el periodo.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left">
                {["Materia", "Tipo", "Grupo", "Plantel", "Horario", ""].map((h, i) => (
                  <th key={i} className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-semibold text-slate-700">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clases.map((c, i) => (
                <tr key={i} className="break-inside-avoid">
                  <td className="border border-slate-200 px-2 py-1.5 text-slate-800 align-top">{c.materia}</td>
                  <td className="border border-slate-200 px-2 py-1.5 text-slate-600 align-top">{c.tipo ?? "—"}</td>
                  <td className="border border-slate-200 px-2 py-1.5 text-slate-600 align-top">{c.grupo ?? "—"}</td>
                  <td className="border border-slate-200 px-2 py-1.5 text-slate-600 align-top whitespace-nowrap">{plantelCorto(c.plantel)}</td>
                  <td className="border border-slate-200 px-2 py-1.5 text-slate-600 align-top whitespace-nowrap">{horario(c)}</td>
                  <td className="border border-slate-200 px-2 py-1.5 align-top whitespace-nowrap">
                    {c.estado !== "confirmada" && (
                      <span className="text-xs text-amber-700">Tentativa</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totales.tentativas > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            * Las materias marcadas como <span className="text-amber-700">Tentativa</span> aún están sujetas a
            confirmación por parte de coordinación académica.
          </p>
        )}
      </section>

      {/* Desglose de horas por módulo: suma de la duración de cada clase dentro de su tipo. */}
      {horasPorModulo.length > 0 && (
        <section className="mb-6 break-inside-avoid">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Horas por módulo</h2>
          <table className="w-full sm:w-1/2 text-sm border-collapse">
            <tbody>
              {horasPorModulo.map((m, i) => (
                <tr key={i}>
                  <td className="border border-slate-200 px-2 py-1.5 text-slate-700">{m.tipo}</td>
                  <td className="border border-slate-200 px-2 py-1.5 text-right text-slate-700 whitespace-nowrap">
                    {m.horas} {m.horas === 1 ? "hora" : "horas"}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 font-semibold text-slate-800">Total</td>
                <td className="border border-slate-300 bg-slate-100 px-2 py-1.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                  {totales.horasSemana} horas/semana
                </td>
              </tr>
            </tbody>
          </table>
          {totales.sinHorario > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              No se incluyen {totales.sinHorario} clase{totales.sinHorario === 1 ? "" : "s"} en línea (sin hora fija).
            </p>
          )}
        </section>
      )}

      <footer className="mt-8 border-t border-slate-300 pt-4 text-xs text-slate-500 break-inside-avoid">
        <p>
          Esta propuesta refleja la asignación de materias para el periodo indicado. Cualquier ajuste de horario o
          materia será notificado por la Coordinación Académica de CENYCA.
        </p>
        <p className="mt-3 grid grid-cols-2 gap-8">
          <span className="border-t border-slate-400 pt-1 text-center">Coordinación Académica</span>
          <span className="border-t border-slate-400 pt-1 text-center">Recibí de conformidad — {prof.nombre}</span>
        </p>
      </footer>
    </div>
  );
}
