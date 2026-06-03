import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfesor } from "@/lib/queries";
import { Estado, TipoClase, plantelCorto } from "@/lib/ui";
import { quitarAsignacion, eliminarDocente } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";

export default async function ProfesorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getProfesor(Number(id));
  if (!data) notFound();
  const { prof, candidatas, asignaciones, historial } = data;

  // Para distinguir lo que YA da de lo que todavía es una oportunidad.
  const yaAsignadas = new Set(asignaciones.map((a) => a.materia));
  // Una misma materia puede venir por historial Y por CV: nos quedamos con la señal más fuerte
  // (mayor puntaje) para no repetirla y para clasificarla en el nivel correcto.
  const porMateria = new Map<number, (typeof candidatas)[number]>();
  for (const c of candidatas) {
    const prev = porMateria.get(c.materia_id);
    if (!prev || c.puntaje > prev.puntaje) porMateria.set(c.materia_id, c);
  }
  const todas = [...porMateria.values()]
    .map((c) => ({ ...c, yaLaDa: yaAsignadas.has(c.materia) }))
    .sort((a, b) => Number(a.yaLaDa) - Number(b.yaLaDa) || b.puntaje - a.puntaje);
  // Tres niveles de señal: ya la impartió (40, hecho) · CV fuerte (25) · afinidad débil (15/8, se colapsa).
  const impartio = todas.filter((c) => c.puntaje >= 40);
  const cvFuerte = todas.filter((c) => c.puntaje >= 25 && c.puntaje < 40);
  const afinidad = todas.filter((c) => c.puntaje < 25);
  const disponibles = todas.filter((c) => !c.yaLaDa).length;

  const stat = (n: number, label: string, color: string) => (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className={`text-2xl font-semibold ${n === 0 ? "text-slate-300" : color}`}>{n}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );

  // Cada materia recomendada como una "pastilla" compacta. ✓ = ya la tiene asignada (atenuada);
  // disponible = blanca. El detalle (razón + puntaje) va en el tooltip para no llenar de texto.
  const chipReco = (c: (typeof todas)[number]) => (
    <span key={c.materia_id} title={`${c.razon ? c.razon + " · " : ""}puntaje ${c.puntaje}`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border ${
        c.yaLaDa ? "bg-slate-100 text-slate-400 border-slate-200"
                 : "bg-white text-slate-700 border-slate-300"}`}>
      {c.yaLaDa && <span className="text-green-600 text-xs">✓</span>}
      {c.materia}
    </span>
  );

  return (
    <div className="space-y-5">
      <Link href="/profesores" className="text-sm text-blue-700 hover:underline">← Profesores</Link>

      {/* Encabezado: identidad y formación, compacto */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-slate-900">{prof.nombre}</h1>
          <div className="flex items-center gap-3 shrink-0 mt-1">
            <span className="text-xs text-slate-400">
              {prof.anios_experiencia != null ? `${prof.anios_experiencia} años de experiencia` : "Experiencia s/d"}
            </span>
            <Link href={`/profesores/${prof.id}/editar`} className="text-xs text-blue-700 hover:underline whitespace-nowrap">
              Editar
            </Link>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Coordinación académica:{" "}
          {prof.coordinador
            ? <span className="font-medium text-slate-800">{prof.coordinador}</span>
            : <span className="text-amber-700">sin asignar</span>}
        </p>
        <dl className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div><dt className="text-slate-500">Licenciatura</dt><dd className="text-slate-800">{prof.licenciatura ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Maestría</dt><dd className="text-slate-800">{prof.maestria ?? "—"}</dd></div>
          <div><dt className="text-slate-500">Doctorado</dt><dd className="text-slate-800">{prof.doctorado ?? "—"}</dd></div>
        </dl>
        {prof.cv_archivo ? (
          <p className="mt-3 text-xs text-slate-400">CV leído: {prof.cv_archivo} · por {prof.modelo ?? "—"}</p>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Sin CV cargado — solo se conoce por su historial de clases.</p>
        )}
      </div>

      {/* Números rápidos */}
      <div className="grid grid-cols-3 gap-2">
        {stat(historial.length, "Clases que dio (mayo)", "text-slate-700")}
        {stat(asignaciones.length, "Asignadas en septiembre", "text-green-700")}
        {stat(candidatas.length, "Materias que puede dar", "text-blue-700")}
      </div>

      {/* Lo que da AHORA: lo más accionable arriba */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">Clases de septiembre asignadas a este docente</h2>
        <p className="mb-3 text-xs text-slate-400">
          &quot;Sugerida&quot; = el sistema la propuso, falta que coordinación la confirme · &quot;Confirmada&quot; = ya aprobada por coordinación.
        </p>
        {asignaciones.length === 0 ? (
          <p className="text-sm text-slate-400">Todavía no tiene clases asignadas para septiembre.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-left">
                <tr>
                  <th className="py-1 font-medium">Materia</th>
                  <th className="py-1 font-medium">Tipo</th>
                  <th className="py-1 font-medium">Grupo</th>
                  <th className="py-1 font-medium">Plantel</th>
                  <th className="py-1 font-medium">Horario</th>
                  <th className="py-1 font-medium">Estado</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {asignaciones.map((a, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-2 text-slate-800">{a.materia}</td>
                    <td className="py-1.5 pr-2"><TipoClase t={a.tipo} /></td>
                    <td className="py-1.5 pr-2 text-slate-600">{a.grupo ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-slate-600 whitespace-nowrap">{plantelCorto(a.plantel)}</td>
                    <td className="py-1.5 pr-2 text-slate-600 whitespace-nowrap">{a.dia ? `${a.dia} ${a.hora_inicio}-${a.hora_fin}` : "—"}</td>
                    <td className="py-1.5"><Estado e={a.estado} /></td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <Link href={`/asignacion/${a.slot_id}`} className="text-blue-700 hover:underline text-xs">Ver</Link>
                        <form action={quitarAsignacion.bind(null, a.slot_id, prof.id)}>
                          <ConfirmButton
                            message={`¿Quitar a ${prof.nombre} de "${a.materia}"? La clase quedará sin docente (libre para reasignar).`}
                            className="text-red-600 hover:underline text-xs">
                            Quitar
                          </ConfirmButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lo que YA dio: historial real */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Clases que dio antes (historial de mayo)</h2>
        {historial.length === 0 ? (
          <p className="text-sm text-slate-400">No hay registro de clases que haya dado en el ciclo de mayo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-left">
                <tr>
                  <th className="py-1 font-medium">Materia</th>
                  <th className="py-1 font-medium">Tipo</th>
                  <th className="py-1 font-medium">Grupo</th>
                  <th className="py-1 font-medium">Plantel</th>
                  <th className="py-1 font-medium">Cuatrimestre</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historial.map((h, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-2 text-slate-800">{h.materia}</td>
                    <td className="py-1.5 pr-2"><TipoClase t={h.tipo} /></td>
                    <td className="py-1.5 pr-2 text-slate-600">{h.grupo ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-slate-600 whitespace-nowrap">{plantelCorto(h.plantel)}</td>
                    <td className="py-1.5 text-slate-600">{h.cuatrimestre ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Materias que puede dar: por niveles de señal, en pastillas compactas (no una tabla infinita).
          Lo fuerte (impartió + CV fuerte) se ve de entrada; la afinidad débil se colapsa. */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Materias que puede dar</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Ordenadas por qué tan fuerte es la señal{disponibles > 0 ? ` · ${disponibles} disponible${disponibles === 1 ? "" : "s"} para asignar` : ""}.
            {" "}<span className="text-green-600">✓</span> = ya la tiene asignada en septiembre · pasa el cursor sobre cada una para ver la razón.
          </p>
        </div>

        {todas.length === 0 ? (
          <p className="text-sm text-slate-400">Sin recomendaciones.</p>
        ) : (
          <>
            {impartio.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium text-slate-500">
                  Ya las impartió <span className="font-normal text-slate-400">({impartio.length}) · la señal más fuerte</span>
                </div>
                <div className="flex flex-wrap gap-2">{impartio.map(chipReco)}</div>
              </div>
            )}

            {cvFuerte.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium text-slate-500">
                  Sugeridas por su CV <span className="font-normal text-slate-400">({cvFuerte.length}) · buena afinidad</span>
                </div>
                <div className="flex flex-wrap gap-2">{cvFuerte.map(chipReco)}</div>
              </div>
            )}

            {afinidad.length > 0 && (
              <details>
                <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-700">
                  Otras posibles por afinidad <span className="font-normal text-slate-400">({afinidad.length}) · señal débil — clic para ver</span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">{afinidad.map(chipReco)}</div>
              </details>
            )}
          </>
        )}
      </div>

      {/* Borrar docente: acción destructiva, separada y con aviso de lo que implica. */}
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-red-800">Borrar este docente</h2>
            <p className="mt-0.5 text-xs text-red-600">
              Úsalo si el docente ya no va (renunció, se duplicó, etc.). Se elimina del sistema junto con su
              CV y las materias que podía dar.
              {asignaciones.length > 0
                ? ` Sus ${asignaciones.length} clase${asignaciones.length === 1 ? "" : "s"} de septiembre quedarán sin maestro (libres para reasignar).`
                : " No tiene clases asignadas en septiembre."}
              {" "}No se puede deshacer.
            </p>
          </div>
          <form action={eliminarDocente.bind(null, prof.id)}>
            <ConfirmButton
              message={`¿Borrar definitivamente a ${prof.nombre}? Se elimina del sistema junto con su CV y las materias que podía dar.${asignaciones.length > 0 ? ` Sus ${asignaciones.length} clase(s) de septiembre quedarán sin maestro.` : ""} Esto NO se puede deshacer.`}
              className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm whitespace-nowrap">
              Borrar docente
            </ConfirmButton>
          </form>
        </div>
      </div>
    </div>
  );
}
