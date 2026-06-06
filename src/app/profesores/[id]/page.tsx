import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfesor } from "@/lib/queries";
import { Estado, PropuestaEstado, TipoClase, plantelCorto, cicloLabel } from "@/lib/ui";
import { quitarAsignacion, eliminarDocente } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";
import { ExportButtons } from "@/lib/export-buttons";
import { MateriasAsignables, type GrupoAbierto } from "./materias-asignables";
import { PropuestaAcciones } from "./propuesta-acciones";

export default async function ProfesorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getProfesor(Number(id));
  if (!data) notFound();
  const { prof, candidatas, asignaciones, historial, gruposAbiertos } = data;

  // Grupos abiertos (sin docente) agrupados por materia, para poder asignarlo desde su ficha.
  const gruposPorMateria = new Map<number, GrupoAbierto[]>();
  for (const g of gruposAbiertos) {
    const lista = gruposPorMateria.get(g.materia_id) ?? [];
    lista.push(g);
    gruposPorMateria.set(g.materia_id, lista);
  }

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
    .map((c) => ({
      materia_id: c.materia_id, materia: c.materia, puntaje: c.puntaje, razon: c.razon,
      yaLaDa: yaAsignadas.has(c.materia),
      grupos: gruposPorMateria.get(c.materia_id) ?? [],
    }))
    // Ordena: primero las que SÍ se pueden asignar (no asignadas y con grupos abiertos), luego por puntaje.
    .sort((a, b) =>
      Number(a.yaLaDa) - Number(b.yaLaDa) ||
      Number(b.grupos.length > 0) - Number(a.grupos.length > 0) ||
      b.puntaje - a.puntaje);
  // Tres niveles de señal: ya la impartió (40, hecho) · CV fuerte (25) · afinidad débil (15/8, se colapsa).
  const impartio = todas.filter((c) => c.puntaje >= 40);
  const cvFuerte = todas.filter((c) => c.puntaje >= 25 && c.puntaje < 40);
  const afinidad = todas.filter((c) => c.puntaje < 25);
  const disponibles = todas.filter((c) => !c.yaLaDa).length;

  // Correo pregrabado (mailto): abre el cliente de correo del coordinador con destinatario,
  // asunto y cuerpo ya escritos (resumen de materias + horas). La app NO envía: el coordinador
  // revisa y da "Enviar" desde su propia cuenta institucional. El botón se deshabilita sin correo.
  const aMin = (h: string | null) => {
    if (!h) return null;
    const [hh, mm] = h.split(":").map(Number);
    return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : null;
  };
  const minutos = asignaciones.reduce((acc, a) => {
    const i = aMin(a.hora_inicio), f = aMin(a.hora_fin);
    return acc + (i != null && f != null && f > i ? f - i : 0);
  }, 0);
  const horasSemana = Math.round((minutos / 60) * 10) / 10;
  const ciclo = asignaciones.find((a) => a.ciclo)?.ciclo ?? null;
  const lineasMaterias = asignaciones.map((a) => {
    const horario = a.dia ? `${a.dia} ${a.hora_inicio ?? ""}-${a.hora_fin ?? ""}`.trim() : "En línea (sin hora fija)";
    const tentativa = a.estado !== "confirmada" ? " (tentativa)" : "";
    return `- ${a.materia}${a.tipo ? ` (${a.tipo})` : ""} · ${a.grupo ?? "s/grupo"} · ${plantelCorto(a.plantel)} · ${horario}${tentativa}`;
  });
  const asuntoCorreo = `Propuesta Académica — ${cicloLabel(ciclo)} · CENYCA`;
  const cuerpoCorreo = [
    `Estimado/a ${prof.nombre}:`,
    "",
    `Por medio de la presente, la Coordinación Académica de CENYCA (IBERO Tijuana) le comparte su Propuesta Académica para el periodo ${cicloLabel(ciclo)}. A continuación, las materias y horarios asignados:`,
    "",
    ...lineasMaterias,
    "",
    `Total: ${asignaciones.length} materia(s) · ${horasSemana} horas/semana.`,
    "",
    "Le pedimos confirmar de recibido y su conformidad respondiendo a este correo. Quedamos atentos a cualquier comentario o ajuste.",
    "",
    "Atentamente,",
    "Coordinación Académica — CENYCA",
    "IBERO Tijuana",
  ].join("\r\n");
  const mailtoHref = prof.correo
    ? `mailto:${encodeURIComponent(prof.correo)}?subject=${encodeURIComponent(asuntoCorreo)}&body=${encodeURIComponent(cuerpoCorreo)}`
    : null;

  const fechaCorta = (s: string) => {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  };

  const stat = (n: number, label: string, color: string) => (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className={`text-2xl font-semibold ${n === 0 ? "text-slate-300" : color}`}>{n}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/profesores" className="text-sm text-blue-700 hover:underline">← Profesores</Link>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/imprimir/propuesta/${prof.id}`}
            target="_blank"
            className="px-2.5 py-1.5 rounded-md bg-slate-900 text-white text-sm whitespace-nowrap">
            Propuesta Académica (PDF)
          </Link>
          <PropuestaAcciones
            profesorId={prof.id}
            estado={prof.propuesta_estado}
            mailtoHref={mailtoHref}
            nombre={prof.nombre}
          />
          <ExportButtons tipo="profesor" params={{ id: prof.id }} />
        </div>
      </div>

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
          <span className="mx-2 text-slate-300">·</span>
          Correo:{" "}
          {prof.correo
            ? <a href={`mailto:${prof.correo}`} className="font-medium text-blue-700 hover:underline">{prof.correo}</a>
            : <span className="text-amber-700">sin correo</span>}
        </p>
        <p className="mt-2 text-sm flex items-center gap-2">
          <span className="text-slate-600">Propuesta:</span>
          <PropuestaEstado e={prof.propuesta_estado} />
          {prof.propuesta_estado === "confirmada" && prof.propuesta_confirmada_en && (
            <span className="text-xs text-slate-400">confirmada el {fechaCorta(prof.propuesta_confirmada_en)}</span>
          )}
          {prof.propuesta_estado === "enviada" && prof.propuesta_enviada_en && (
            <span className="text-xs text-slate-400">enviada el {fechaCorta(prof.propuesta_enviada_en)}</span>
          )}
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
          &quot;Sugerida&quot; = el sistema la propuso, falta revisarla · &quot;Asignada&quot; = coordinación la fijó en esa clase. (La propuesta del docente se confirma arriba, una vez enviada.)
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

      {/* Materias que puede dar: pastillas por nivel de señal. Al hacer clic en una materia con
          grupos abiertos se despliegan abajo sus grupos sin docente para asignarlo ahí mismo. */}
      <MateriasAsignables
        impartio={impartio} cvFuerte={cvFuerte} afinidad={afinidad}
        profesorId={prof.id} nombre={prof.nombre} disponibles={disponibles}
      />

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
