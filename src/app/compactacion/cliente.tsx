"use client";
// Pantalla de Compactación (cliente). Tres bloques:
//   1. Clases YA compactadas (con su docente/horario y botón "Separar" — 100% reversible).
//   2. Candidatas: materias abiertas en 2+ grupos del mismo plantel. El coordinador marca
//      grupos (de la MISMA materia, o de varias si confirma) y los compacta en una clase.
//   3. Barra flotante de acción: resumen de lo seleccionado + panel de confirmación con
//      razón (queda en el historial), horario compartido y docente opcional.
//
// Candados (además de los del servidor): avisamos en pantalla cuando el horario no coincide
// (hay que elegir uno), cuando se mezclan materias distintas, o cuando se cruzan turnos.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { plantelCorto } from "@/lib/ui";
import { compactar, separar, marcarChico, editarRazonCompactacion, agregarACompactacion, homogeneizarHorarioCompactacion, editarAlumnosGrupo } from "@/app/actions";
import type { CompactCandidato, CompactGrupo, CompactacionActiva, DocenteCandidato } from "@/lib/queries";

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const horarioTxt = (g: { dia: string | null; hora_inicio: string | null; hora_fin: string | null }) =>
  g.dia && g.hora_inicio && g.hora_fin ? `${g.dia} ${g.hora_inicio}–${g.hora_fin}` : "sin horario";

const firma = (g: { dia: string | null; hora_inicio: string | null; hora_fin: string | null }) =>
  g.dia && g.hora_inicio && g.hora_fin ? `${g.dia}|${g.hora_inicio}|${g.hora_fin}` : "";

const turnoDe = (clave: string | null) => clave?.split("_")[2] ?? null;   // PLAN_Gnn_TURNO_CAMPUS

// Quita acentos y pasa a minúsculas: "mecanica" encuentra "MECÁNICA".
const normaliza = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

const POR_PAGINA = 20;   // candidatas mostradas de inicio (cada "Mostrar más" suma otras tantas)

type SlotInfo = CompactGrupo & { materia_id: number; materia: string; plantel: string };

export function CompactacionCliente({
  candidatos, compactaciones, docentesPorMateria, libresPorClave,
}: {
  candidatos: CompactCandidato[];
  compactaciones: CompactacionActiva[];
  docentesPorMateria: Record<number, DocenteCandidato[]>;
  libresPorClave: Record<string, CompactGrupo[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Selección de grupos (por slot_id) y panel de confirmación.
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [razon, setRazon] = useState("");
  const [docenteId, setDocenteId] = useState<number | "">("");
  const [horarioElegido, setHorarioElegido] = useState<string>("");   // firma elegida, o "custom"
  const [custom, setCustom] = useState({ dia: "Lunes", hora_inicio: "", hora_fin: "" });
  const [confirmarMateria, setConfirmarMateria] = useState(false);

  // Búsqueda + filtros + paginación (todo en cliente: la lista ya viene cargada).
  const [busca, setBusca] = useState("");
  const [filtroPlantel, setFiltroPlantel] = useState("");
  const [soloListos, setSoloListos] = useState(false);
  const [soloChicos, setSoloChicos] = useState(false);
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());   // tarjetas abiertas manualmente

  // Índice slot_id -> info del grupo+materia (para derivar materia/plantel/horario de la selección).
  const indice = useMemo(() => {
    const m = new Map<number, SlotInfo>();
    for (const c of candidatos)
      for (const g of c.grupos)
        m.set(g.slot_id, { ...g, materia_id: c.materia_id, materia: c.materia, plantel: c.plantel });
    return m;
  }, [candidatos]);

  const seleccionados = useMemo(
    () => [...sel].map((id) => indice.get(id)).filter((x): x is SlotInfo => !!x),
    [sel, indice]);

  // Diagnóstico de la selección.
  const planteles = [...new Set(seleccionados.map((s) => s.plantel))];
  const materiasSel = [...new Set(seleccionados.map((s) => s.materia_id))];
  const firmasSel = [...new Set(seleccionados.map((s) => firma(s)).filter(Boolean))];
  const turnosSel = [...new Set(seleccionados.map((s) => turnoDe(s.grupo)).filter(Boolean))];
  const sinHorario = seleccionados.some((s) => !firma(s));
  // Aforo de la selección: suma de alumnos de los grupos que SÍ traen el dato capturado.
  const conAlumnos = seleccionados.filter((s) => s.alumnos != null);
  const totalAlumnos = conAlumnos.reduce((a, s) => a + (s.alumnos ?? 0), 0);
  const sinCapturar = seleccionados.length - conAlumnos.length;
  const materiaIdSel = materiasSel.length === 1 ? materiasSel[0] : null;
  const docentes = materiaIdSel != null ? (docentesPorMateria[materiaIdSel] ?? []) : [];

  // ¿Hace falta elegir un horario? Sí si hay más de uno distinto, o si algún grupo no tiene horario.
  const horarioAmbiguo = firmasSel.length > 1 || sinHorario;
  // Opciones de horario para elegir: las firmas existentes entre lo seleccionado.
  const opcionesHorario = firmasSel;

  const toggle = (slotId: number) => {
    setError(null);
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(slotId)) n.delete(slotId); else n.add(slotId);
      return n;
    });
  };

  const limpiar = () => {
    setSel(new Set());
    setPanelAbierto(false);
    setRazon(""); setDocenteId(""); setHorarioElegido(""); setConfirmarMateria(false);
    setCustom({ dia: "Lunes", hora_inicio: "", hora_fin: "" });
    setError(null);
  };

  const abrirPanel = () => {
    if (sel.size < 2) { setError("Marca al menos 2 grupos para compactarlos en una sola clase."); return; }
    if (planteles.length > 1) { setError("Solo se pueden compactar grupos del mismo plantel."); return; }
    // Prepara el horario por defecto: si todos coinciden, usa esa firma; si no, deja vacío para elegir.
    setHorarioElegido(firmasSel.length === 1 ? firmasSel[0] : "");
    setError(null);
    setPanelAbierto(true);
  };

  const ejecutarCompactar = () => {
    const ids = [...sel];
    // Resolver horario a enviar al servidor.
    let horario: { dia: string; hora_inicio: string; hora_fin: string } | null = null;
    if (horarioAmbiguo) {
      if (horarioElegido === "custom") {
        if (!custom.dia || !custom.hora_inicio || !custom.hora_fin) { setError("Captura día y hora (inicio y fin) del horario compartido."); return; }
        horario = { dia: custom.dia, hora_inicio: custom.hora_inicio, hora_fin: custom.hora_fin };
      } else if (horarioElegido) {
        const [dia, hi, hf] = horarioElegido.split("|");
        horario = { dia, hora_inicio: hi, hora_fin: hf };
      } else {
        setError("Elige a qué día y hora quedará la clase compactada."); return;
      }
    }
    if (materiasSel.length > 1 && !confirmarMateria) {
      setError("Marcaste grupos de materias con distinto nombre. Confirma abajo que es la misma clase."); return;
    }
    setError(null);
    start(async () => {
      const r = await compactar(ids, {
        razon: razon.trim() || undefined,
        horario,
        docenteId: docenteId === "" ? null : Number(docenteId),
        confirmarMateriaDistinta: materiasSel.length > 1 ? confirmarMateria : undefined,
      });
      if (!r.ok) { setError(r.error); return; }
      limpiar();
      router.refresh();
    });
  };

  const ejecutarChico = (grupoId: number, valor: boolean) => {
    start(async () => {
      await marcarChico(grupoId, valor);
      router.refresh();
    });
  };

  const conListos = candidatos.filter((c) => c.listos.length > 0);
  const totalListos = conListos.reduce((s, c) => s + c.listos.reduce((a, cl) => a + cl.grupos.length, 0), 0);
  const totalChicos = candidatos.reduce((s, c) => s + c.grupos.filter((g) => g.es_chico).length, 0);

  // Opciones de plantel para el filtro (de las materias candidatas).
  const plantelesOpts = useMemo(
    () => [...new Set(candidatos.map((c) => c.plantel))].sort((a, b) => plantelCorto(a).localeCompare(plantelCorto(b))),
    [candidatos]);

  // Candidatas tras aplicar buscador + filtros. Coincide por materia, plantel o clave de grupo.
  const candFiltrados = useMemo(() => {
    const t = normaliza(busca);
    const terminos = t ? t.split(/\s+/).filter(Boolean) : [];
    return candidatos.filter((c) => {
      if (filtroPlantel && c.plantel !== filtroPlantel) return false;
      if (soloListos && c.listos.length === 0) return false;
      if (soloChicos && !c.grupos.some((g) => g.es_chico)) return false;
      if (terminos.length) {
        const heno = normaliza(`${c.materia} ${plantelCorto(c.plantel)} ${c.plantel} ${c.grupos.map((g) => g.grupo).join(" ")}`);
        if (!terminos.every((term) => heno.includes(term))) return false;
      }
      return true;
    });
  }, [candidatos, busca, filtroPlantel, soloListos, soloChicos]);

  // Compactaciones activas tras el buscador (mismo término).
  const compFiltradas = useMemo(() => {
    const t = normaliza(busca);
    const terminos = t ? t.split(/\s+/).filter(Boolean) : [];
    if (!terminos.length && !filtroPlantel) return compactaciones;
    return compactaciones.filter((c) => {
      if (filtroPlantel && c.plantel !== filtroPlantel) return false;
      if (!terminos.length) return true;
      const heno = normaliza(`${c.materia ?? ""} ${plantelCorto(c.plantel)} ${c.grupos.map((g) => g.grupo).join(" ")} ${c.profesor ?? ""}`);
      return terminos.every((term) => heno.includes(term));
    });
  }, [compactaciones, busca, filtroPlantel]);

  const hayFiltro = busca.trim().length > 0 || filtroPlantel !== "" || soloListos || soloChicos;

  // Al cambiar la búsqueda/filtros volvemos a la primera página (patrón de ajuste en render).
  const filtroKey = `${busca}|${filtroPlantel}|${soloListos}|${soloChicos}`;
  const [prevFiltroKey, setPrevFiltroKey] = useState(filtroKey);
  if (filtroKey !== prevFiltroKey) { setPrevFiltroKey(filtroKey); setVisibles(POR_PAGINA); }

  // Buscar abre las tarjetas automáticamente (para ver lo que coincide sin clic extra).
  const autoExpand = busca.trim().length > 0;
  const mostrados = candFiltrados.slice(0, visibles);
  const faltan = candFiltrados.length - mostrados.length;

  const limpiarFiltros = () => { setBusca(""); setFiltroPlantel(""); setSoloListos(false); setSoloChicos(false); };
  const toggleTarjeta = (key: string) =>
    setExpandidas((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="space-y-4 pb-28">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Compactación de grupos</h1>
        <p className="text-sm text-slate-500">
          Junta en <b>una sola clase</b> (un docente, un aula, un horario) la misma materia que se abre en
          varios grupos del mismo plantel. Marca los grupos y pulsa <b>Compactar</b>. Todo es reversible:
          puedes <b>Separar</b> cuando quieras.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card title="Clases ya compactadas" value={compactaciones.length} hint="activas en este ciclo" />
        <Card title="Materias candidatas" value={candidatos.length} hint="abiertas en 2+ grupos" />
        <Card title="Con horario que coincide" value={conListos.length} hint="se juntan sin mover nada" />
        <Card title="Grupos listos para juntar" value={totalListos} hint="mismo día y hora" />
        <Card title="Grupos marcados reducidos" value={totalChicos} hint="marca manual del coordinador" />
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-blue-900">
        <b>¿Qué es esto?</b> Cuando un grupo reducido lleva la misma materia que otra carrera, en vez de abrir
        dos clases casi vacías (dos docentes, dos aulas) se juntan en una sola. Los grupos en{" "}
        <span className="text-emerald-700 font-medium">verde</span> ya están a la misma hora: se compactan sin
        mover nada. Si están en horarios distintos, eliges a qué hora queda la clase. Puedes <b>capturar el
        número de alumnos</b> de cada grupo en su pastilla (sirve para el aforo del aula y las alertas);
        usa <b>“grupo reducido”</b> para marcarlos tú.
      </div>

      {/* ---------- Buscador + filtros ---------- */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-slate-50/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar materia, plantel o grupo…"
              autoComplete="off"
              className="w-full pl-9 pr-8 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden>⌕</span>
            {busca && (
              <button type="button" onClick={() => setBusca("")} aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">✕</button>
            )}
          </div>
          {plantelesOpts.length > 1 && (
            <select value={filtroPlantel} onChange={(e) => setFiltroPlantel(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-2 text-sm bg-white">
              <option value="">Todos los planteles</option>
              {plantelesOpts.map((p) => <option key={p} value={p}>{plantelCorto(p)}</option>)}
            </select>
          )}
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1.5 rounded-md border border-slate-200 bg-white cursor-pointer">
            <input type="checkbox" checked={soloListos} onChange={(e) => setSoloListos(e.target.checked)} />
            Solo con horario que coincide
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1.5 rounded-md border border-slate-200 bg-white cursor-pointer">
            <input type="checkbox" checked={soloChicos} onChange={(e) => setSoloChicos(e.target.checked)} />
            Solo con grupo reducido
          </label>
          {hayFiltro && (
            <button type="button" onClick={limpiarFiltros} className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
            {hayFiltro ? `${candFiltrados.length} de ${candidatos.length} materias` : `${candidatos.length} materias`}
          </span>
        </div>
      </div>

      {/* ---------- Clases ya compactadas ---------- */}
      {compFiltradas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Clases compactadas ({compFiltradas.length}{hayFiltro && compFiltradas.length !== compactaciones.length ? ` de ${compactaciones.length}` : ""})
          </h2>
          <div className="space-y-2">
            {compFiltradas.map((c) => (
              <TarjetaCompactada key={c.id} c={c} libres={libresPorClave[`${c.materia_id}|${c.plantel}`] ?? []} />
            ))}
          </div>
        </section>
      )}

      {/* ---------- Candidatas ---------- */}
      {candidatos.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          No hay materias abiertas en 2 o más grupos sin compactar en el ciclo seleccionado.
        </div>
      ) : candFiltrados.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          Ninguna materia candidata coincide con los filtros.{" "}
          <button type="button" onClick={limpiarFiltros} className="text-slate-700 hover:underline">Limpiar filtros</button>.
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Candidatas a compactar</h2>
            <span className="text-xs text-slate-400">— clic en una materia para ver sus grupos</span>
          </div>
          {mostrados.map((c) => {
            const key = `${c.materia_id}|${c.plantel}`;
            const abierta = autoExpand || expandidas.has(key);
            const enListos = new Set(c.listos.flatMap((cl) => cl.grupos.map((g) => g.slot_id)));
            const sueltos = c.grupos.filter((g) => !enListos.has(g.slot_id));
            const nChicos = c.grupos.filter((g) => g.es_chico).length;
            const nListos = c.listos.reduce((a, cl) => a + cl.grupos.length, 0);
            const seleccionarCluster = (grupos: CompactGrupo[]) => {
              setError(null);
              setSel((prev) => { const n = new Set(prev); for (const g of grupos) n.add(g.slot_id); return n; });
            };
            const seleccionarTodosListos = () => seleccionarCluster(c.listos.flatMap((cl) => cl.grupos));
            return (
              <div key={key} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleTarjeta(key)}
                  className="w-full flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50 text-left hover:bg-slate-100">
                  <span className="text-slate-400 text-xs w-3" aria-hidden>{abierta ? "▾" : "▸"}</span>
                  <span className="font-medium text-slate-800">{c.materia}</span>
                  <span className="text-xs text-slate-500">· {plantelCorto(c.plantel)}</span>
                  <span className="text-xs text-slate-400">· {c.grupos.length} grupos</span>
                  {nChicos > 0 && (
                    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
                      {nChicos} reducido{nChicos === 1 ? "" : "s"}
                    </span>
                  )}
                  {c.listos.length > 0 && (
                    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {c.listos.length} horario{c.listos.length === 1 ? "" : "s"} ya coincide{c.listos.length === 1 ? "" : "n"}
                    </span>
                  )}
                  {nListos >= 2 && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); seleccionarTodosListos(); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); seleccionarTodosListos(); } }}
                      className="ml-auto text-[11px] px-2 py-0.5 rounded border border-emerald-300 text-emerald-800 hover:bg-emerald-50 cursor-pointer">
                      Seleccionar {nListos} listos
                    </span>
                  )}
                </button>

                {abierta && (
                  <>
                    {c.listos.map((cl) => (
                      <div key={cl.horario} className="border-b border-slate-100">
                        <div className="flex items-center gap-2 px-3 pt-2">
                          <span className="text-[11px] font-medium text-emerald-700">Mismo horario ({cl.horario}) — listos para compactar</span>
                          <button
                            type="button"
                            onClick={() => seleccionarCluster(cl.grupos)}
                            className="text-[11px] px-2 py-0.5 rounded border border-emerald-300 text-emerald-800 hover:bg-emerald-50">
                            Seleccionar estos {cl.grupos.length}
                          </button>
                        </div>
                        <div className="divide-y divide-emerald-100/70">
                          {cl.grupos.map((g) => (
                            <Fila key={g.slot_id} g={g} resaltar checked={sel.has(g.slot_id)} onToggle={() => toggle(g.slot_id)} onChico={ejecutarChico} pending={pending} />
                          ))}
                        </div>
                      </div>
                    ))}

                    {sueltos.length > 0 && (
                      <div className="divide-y divide-slate-100">
                        {c.listos.length > 0 && (
                          <div className="px-3 pt-2 text-[11px] font-medium text-slate-400">Otros grupos (horario distinto)</div>
                        )}
                        {sueltos.map((g) => (
                          <Fila key={g.slot_id} g={g} checked={sel.has(g.slot_id)} onToggle={() => toggle(g.slot_id)} onChico={ejecutarChico} pending={pending} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {faltan > 0 && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <button type="button" onClick={() => setVisibles((v) => v + POR_PAGINA)}
                className="px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">
                Mostrar más ({Math.min(POR_PAGINA, faltan)} de {faltan} restantes)
              </button>
              {candFiltrados.length > POR_PAGINA && (
                <button type="button" onClick={() => setVisibles(candFiltrados.length)}
                  className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
                  Ver todas ({candFiltrados.length})
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* ---------- Barra flotante + panel de confirmación ---------- */}
      {sel.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white shadow-lg">
          <div className="mx-auto max-w-6xl px-4 py-3 max-h-[80vh] overflow-y-auto">
            {error && <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

            {!panelAbierto ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-700"><b>{sel.size}</b> grupo(s) seleccionado(s)</span>
                {conAlumnos.length > 0 && (
                  <span className="text-xs text-slate-500">
                    · {sinCapturar > 0 ? "~" : ""}<b className="text-slate-700">{totalAlumnos}</b> alumno(s) en total
                    {sinCapturar > 0 && <span className="text-amber-600"> (faltan {sinCapturar} por capturar)</span>}
                  </span>
                )}
                {planteles.length > 1 && <span className="text-xs text-red-600">⚠ Son de planteles distintos: no se pueden compactar juntos.</span>}
                {planteles.length === 1 && materiasSel.length > 1 && <span className="text-xs text-amber-600">⚠ Materias con distinto nombre (lo confirmarás al compactar).</span>}
                {planteles.length === 1 && horarioAmbiguo && <span className="text-xs text-amber-600">⚠ Horarios distintos: elegirás uno.</span>}
                {turnosSel.length > 1 && <span className="text-xs text-amber-600">⚠ Cruza turnos ({turnosSel.join("/")}).</span>}
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={limpiar} className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">Limpiar</button>
                  <button type="button" onClick={abrirPanel} disabled={sel.size < 2 || planteles.length > 1}
                    className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-50">
                    Compactar {sel.size} grupos →
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">
                    Compactar {sel.size} grupos de “{seleccionados[0]?.materia}” en {plantelCorto(planteles[0])}
                  </span>
                  <button type="button" onClick={() => setPanelAbierto(false)} className="ml-auto text-sm text-slate-500 hover:text-slate-700">← Volver</button>
                </div>

                {/* Horario compartido (solo si no coinciden) */}
                {horarioAmbiguo && (
                  <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2">
                    <div className="text-xs font-medium text-amber-800 mb-1">Los grupos no comparten horario. Elige a qué día y hora queda la clase:</div>
                    <div className="flex flex-wrap gap-2 items-center text-sm">
                      {opcionesHorario.map((f) => {
                        const [dia, hi, hf] = f.split("|");
                        return (
                          <label key={f} className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-200 bg-white cursor-pointer">
                            <input type="radio" name="horario-barra" checked={horarioElegido === f} onChange={() => setHorarioElegido(f)} />
                            <span>{dia} {hi}–{hf}</span>
                          </label>
                        );
                      })}
                      <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-200 bg-white cursor-pointer">
                        <input type="radio" name="horario-barra" checked={horarioElegido === "custom"} onChange={() => setHorarioElegido("custom")} />
                        <span>Otro:</span>
                        <select value={custom.dia} onChange={(e) => setCustom({ ...custom, dia: e.target.value })} className="border border-slate-200 rounded px-1 py-0.5 text-xs">
                          {DIAS.map((d) => <option key={d}>{d}</option>)}
                        </select>
                        <input placeholder="07:00" value={custom.hora_inicio} onChange={(e) => setCustom({ ...custom, hora_inicio: e.target.value })} className="w-16 border border-slate-200 rounded px-1 py-0.5 text-xs" />
                        <span>–</span>
                        <input placeholder="09:00" value={custom.hora_fin} onChange={(e) => setCustom({ ...custom, hora_fin: e.target.value })} className="w-16 border border-slate-200 rounded px-1 py-0.5 text-xs" />
                      </label>
                    </div>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Razón de la compactación (queda en el historial)</label>
                    <textarea value={razon} onChange={(e) => setRazon(e.target.value)} rows={2}
                      placeholder="Ej. Grupos reducidos de Mecatrónica e Industrial: misma materia troncal."
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Docente (opcional — también puedes asignarlo luego en Asignación)</label>
                    <select value={docenteId} onChange={(e) => setDocenteId(e.target.value === "" ? "" : Number(e.target.value))}
                      disabled={materiaIdSel == null}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50">
                      <option value="">— Sin asignar por ahora —</option>
                      {docentes.map((d) => (
                        <option key={d.profesor_id} value={d.profesor_id}>{d.nombre} · {d.carga} clases</option>
                      ))}
                    </select>
                    {materiaIdSel == null && <p className="text-[11px] text-slate-400 mt-1">Mezclaste materias distintas; asigna el docente después.</p>}
                  </div>
                </div>

                {materiasSel.length > 1 && (
                  <label className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50/60 border border-amber-200 rounded-md px-3 py-2">
                    <input type="checkbox" checked={confirmarMateria} onChange={(e) => setConfirmarMateria(e.target.checked)} className="mt-0.5" />
                    <span>Confirmo que estos grupos llevan la <b>misma clase</b> aunque la materia esté escrita distinto.</span>
                  </label>
                )}

                <div className="flex items-center gap-2">
                  <button type="button" onClick={limpiar} className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">Cancelar</button>
                  <button type="button" onClick={ejecutarCompactar} disabled={pending}
                    className="ml-auto px-4 py-1.5 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60">
                    {pending ? "Compactando…" : `Compactar ${sel.size} grupos en una clase`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Tarjeta de una clase YA compactada: muestra grupos/horario/docente/aula, con acciones
// reversibles — Separar, Editar razón y Agregar más grupos (de la misma materia y plantel).
function TarjetaCompactada({ c, libres }: { c: CompactacionActiva; libres: CompactGrupo[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [editando, setEditando] = useState(false);
  const [razonDraft, setRazonDraft] = useState(c.razon ?? "");
  const [agregando, setAgregando] = useState(false);
  const [selAgg, setSelAgg] = useState<Set<number>>(new Set());
  const [unificando, setUnificando] = useState(false);
  const [horarioSel, setHorarioSel] = useState<string>("");
  const [customH, setCustomH] = useState({ dia: "Lunes", hora_inicio: "", hora_fin: "" });

  // Horarios distintos presentes entre los grupos de la clase (para ofrecerlos al unificar).
  const firmasMiembros = [...new Set(c.grupos.map((g) => firma(g)).filter(Boolean))];

  const ejecutarSeparar = () => {
    if (!window.confirm(`¿Separar la clase compactada de "${c.materia ?? "esta materia"}"?\n\nLos grupos vuelven a ser clases independientes (conservan su horario y docente). Esto se puede volver a compactar después.`)) return;
    start(async () => {
      const r = await separar(c.id);
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  };

  const guardarRazon = () => {
    start(async () => {
      const r = await editarRazonCompactacion(c.id, razonDraft);
      if (!r.ok) { setError(r.error); return; }
      setEditando(false);
      router.refresh();
    });
  };

  const toggleAgg = (slotId: number) =>
    setSelAgg((prev) => { const n = new Set(prev); if (n.has(slotId)) n.delete(slotId); else n.add(slotId); return n; });

  const ejecutarAgregar = () => {
    if (selAgg.size === 0) { setError("Marca al menos un grupo para agregarlo a la clase."); return; }
    setError(null);
    start(async () => {
      const r = await agregarACompactacion(c.id, [...selAgg]);
      if (!r.ok) { setError(r.error); return; }
      setAgregando(false);
      setSelAgg(new Set());
      router.refresh();
    });
  };

  const ejecutarUnificar = () => {
    let h: { dia: string; hora_inicio: string; hora_fin: string } | null = null;
    if (horarioSel === "custom") {
      if (!customH.dia || !customH.hora_inicio || !customH.hora_fin) { setError("Captura día y hora (inicio y fin) del horario."); return; }
      h = { ...customH };
    } else if (horarioSel) {
      const [dia, hi, hf] = horarioSel.split("|");
      h = { dia, hora_inicio: hi, hora_fin: hf };
    } else { setError("Elige a qué día y hora queda la clase."); return; }
    setError(null);
    start(async () => {
      const r = await homogeneizarHorarioCompactacion(c.id, h!);
      if (!r.ok) { setError(r.error); return; }
      setUnificando(false);
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-emerald-100">
        <span className="font-medium text-slate-800">{c.materia ?? "—"}</span>
        <span className="text-xs text-slate-500">· {plantelCorto(c.plantel)}</span>
        <span className="text-xs text-slate-600 whitespace-nowrap">· {horarioTxt(c)}</span>
        <span className="text-xs whitespace-nowrap">
          · {c.profesor ? <span className="text-slate-600">{c.profesor}</span> : <span className="text-amber-700">sin docente</span>}
        </span>
        <span className="text-xs whitespace-nowrap">
          · {c.aula ? <span className="text-slate-600">aula {c.aula}</span> : <span className="text-slate-400">sin aula</span>}
        </span>
        <span className="ml-auto text-xs text-slate-400">{c.grupos.length} grupos</span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => { setEditando((v) => !v); setAgregando(false); setRazonDraft(c.razon ?? ""); }}
            disabled={pending}
            className="px-2 py-1 rounded-md border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60">
            {editando ? "Cerrar" : "Editar razón"}
          </button>
          {libres.length > 0 && (
            <button type="button" onClick={() => { setAgregando((v) => !v); setEditando(false); setSelAgg(new Set()); setError(null); }}
              disabled={pending}
              className="px-2 py-1 rounded-md border border-emerald-300 bg-white text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-60">
              {agregando ? "Cerrar" : `Agregar grupos (${libres.length})`}
            </button>
          )}
          <button type="button" onClick={ejecutarSeparar} disabled={pending}
            className="px-2 py-1 rounded-md border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60">
            Separar
          </button>
        </div>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {c.grupos.map((g) => (
            <span key={g.slot_id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-white border border-emerald-200 text-slate-600">
              <span className="font-mono">{g.grupo}</span>
              <EditorAlumnos grupoId={g.grupo_id} alumnos={g.alumnos} />
            </span>
          ))}
        </div>
        {(() => {
          const conDato = c.grupos.filter((g) => g.alumnos != null);
          const total = conDato.reduce((s, g) => s + (g.alumnos ?? 0), 0);
          if (conDato.length === 0) return null;
          const faltan = c.grupos.length - conDato.length;
          return (
            <div className="text-[11px] text-slate-500">
              Aforo total: <b className="text-slate-700">{total} alumno(s)</b> en una sola aula
              {faltan > 0 && <span className="text-amber-600"> · faltan {faltan} grupo(s) por capturar</span>}
            </div>
          );
        })()}
      </div>

      {error && <div className="mx-3 mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {(!c.horarioUniforme || !c.docenteUniforme) && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="text-[11px] text-amber-700">
            ⚠ {!c.horarioUniforme && "Los grupos de esta clase no tienen el mismo horario. "}
            {!c.docenteUniforme && "Tienen distinto docente (ajústalo en Asignación). "}
            Para que sea de verdad una sola clase debe compartir horario.
          </div>
          {!c.horarioUniforme && !unificando && (
            <button type="button" onClick={() => { setUnificando(true); setError(null); setHorarioSel(firmasMiembros[0] ?? ""); }}
              disabled={pending}
              className="text-[11px] px-2 py-0.5 rounded border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-60">
              Unificar horario
            </button>
          )}
          {!c.horarioUniforme && unificando && (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 space-y-2">
              <div className="text-[11px] font-medium text-amber-800">Elige a qué día y hora queda TODA la clase:</div>
              <div className="flex flex-wrap gap-2 items-center text-sm">
                {firmasMiembros.map((f) => {
                  const [dia, hi, hf] = f.split("|");
                  return (
                    <label key={f} className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-200 bg-white cursor-pointer">
                      <input type="radio" name={`uni-${c.id}`} checked={horarioSel === f} onChange={() => setHorarioSel(f)} />
                      <span>{dia} {hi}–{hf}</span>
                    </label>
                  );
                })}
                <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-200 bg-white cursor-pointer">
                  <input type="radio" name={`uni-${c.id}`} checked={horarioSel === "custom"} onChange={() => setHorarioSel("custom")} />
                  <span>Otro:</span>
                  <select value={customH.dia} onChange={(e) => setCustomH({ ...customH, dia: e.target.value })} className="border border-slate-200 rounded px-1 py-0.5 text-xs">
                    {DIAS.map((d) => <option key={d}>{d}</option>)}
                  </select>
                  <input placeholder="07:00" value={customH.hora_inicio} onChange={(e) => setCustomH({ ...customH, hora_inicio: e.target.value })} className="w-16 border border-slate-200 rounded px-1 py-0.5 text-xs" />
                  <span>–</span>
                  <input placeholder="09:00" value={customH.hora_fin} onChange={(e) => setCustomH({ ...customH, hora_fin: e.target.value })} className="w-16 border border-slate-200 rounded px-1 py-0.5 text-xs" />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setUnificando(false)} className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button type="button" onClick={ejecutarUnificar} disabled={pending}
                  className="ml-auto px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60">
                  {pending ? "Aplicando…" : "Aplicar a todos"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Editar razón */}
      {editando ? (
        <div className="px-3 pb-3 space-y-2">
          <textarea value={razonDraft} onChange={(e) => setRazonDraft(e.target.value)} rows={2}
            placeholder="Razón de la compactación (queda en el historial)…"
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setEditando(false)} className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="button" onClick={guardarRazon} disabled={pending}
              className="ml-auto px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-60">
              {pending ? "Guardando…" : "Guardar razón"}
            </button>
          </div>
        </div>
      ) : (
        c.razon && <div className="px-3 pb-2 text-[11px] text-slate-500 italic">Razón: {c.razon}</div>
      )}

      {/* Agregar grupos sueltos a esta clase */}
      {agregando && (
        <div className="px-3 pb-3 space-y-2 border-t border-emerald-100 pt-2">
          <div className="text-[11px] text-slate-500">
            Estos grupos de la misma materia siguen sueltos. Al agregarlos adoptan el horario de la clase
            ({horarioTxt(c)}){c.docenteUniforme && c.profesor ? ` y su docente (${c.profesor})` : ""}.
          </div>
          <div className="rounded-md border border-slate-200 bg-white divide-y divide-slate-100">
            {libres.map((g) => (
              <label key={g.slot_id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={selAgg.has(g.slot_id)} onChange={() => toggleAgg(g.slot_id)} />
                <span className="font-mono text-xs text-slate-700">{g.grupo}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600 whitespace-nowrap">{horarioTxt(g)}</span>
                <EditorAlumnos grupoId={g.grupo_id} alumnos={g.alumnos} />
                {g.es_chico && <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-amber-100 text-amber-800 border border-amber-200">reducido</span>}
                <span className="ml-auto text-xs">
                  {g.profesor ? <span className="text-slate-500">{g.profesor}</span> : <span className="text-amber-700">sin docente</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setAgregando(false); setSelAgg(new Set()); }} className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="button" onClick={ejecutarAgregar} disabled={pending || selAgg.size === 0}
              className="ml-auto px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60">
              {pending ? "Agregando…" : `Agregar ${selAgg.size || ""} a la clase`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Fila de un grupo candidato: checkbox de selección, horario, alumnos, docente, marca "reducido".
function Fila({ g, resaltar = false, checked, onToggle, onChico, pending }: {
  g: CompactGrupo; resaltar?: boolean; checked: boolean;
  onToggle: () => void; onChico: (grupoId: number, valor: boolean) => void; pending: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-sm ${resaltar ? "bg-emerald-50/60" : ""} ${checked ? "ring-1 ring-inset ring-slate-300" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mr-1" aria-label={`Seleccionar ${g.grupo}`} />
      <span className="font-mono text-xs text-slate-700">{g.grupo}</span>
      <span className="text-slate-400">·</span>
      <span className="text-slate-600 whitespace-nowrap">{horarioTxt(g)}</span>
      <EditorAlumnos grupoId={g.grupo_id} alumnos={g.alumnos} />
      <button
        type="button"
        onClick={() => onChico(g.grupo_id, !g.es_chico)}
        disabled={pending}
        title="Marca manual del coordinador: grupo reducido (independiente del número de alumnos)."
        className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] border disabled:opacity-60 ${g.es_chico ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"}`}>
        {g.es_chico ? "✓ reducido" : "marcar reducido"}
      </button>
      <span className="ml-auto text-xs">
        {g.profesor ? <span className="text-slate-500">{g.profesor}</span> : <span className="text-amber-700">sin docente</span>}
      </span>
    </div>
  );
}

// Editor inline del número de alumnos de un grupo. El dato vive en `grupos.alumnos`, así que
// el cambio se refleja en todas las pantallas que lo usan (aula, alertas, motor). Click en la
// pastilla → input; Enter/✓ guarda, Esc/✕ cancela. Reversible: siempre se puede volver a editar.
function EditorAlumnos({ grupoId, alumnos }: { grupoId: number; alumnos: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(alumnos == null ? "" : String(alumnos));
  const [error, setError] = useState<string | null>(null);

  const abrir = () => { setValor(alumnos == null ? "" : String(alumnos)); setError(null); setEditando(true); };
  const cerrar = () => { setEditando(false); setError(null); };

  const guardar = () => {
    const t = valor.trim();
    const nuevo = t === "" ? null : Number(t);
    if (nuevo != null && (!Number.isInteger(nuevo) || nuevo < 0 || nuevo > 1000)) {
      setError("Entero de 0 a 1000."); return;
    }
    start(async () => {
      const r = await editarAlumnosGrupo(grupoId, nuevo);
      if (!r.ok) { setError(r.error); return; }
      setEditando(false);
      router.refresh();
    });
  };

  if (!editando) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); abrir(); }}
        title="Capturar/editar alumnos del grupo (afecta aula, alertas y motor)."
        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] border ${
          alumnos != null
            ? "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
            : "bg-white text-slate-400 border-dashed border-slate-300 hover:bg-slate-50"}`}>
        {alumnos != null ? `${alumnos} alum ✎` : "+ alumnos"}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
      <input
        type="number" min={0} max={1000} inputMode="numeric" autoFocus
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); guardar(); }
          if (e.key === "Escape") { e.preventDefault(); cerrar(); }
        }}
        placeholder="alum"
        className="w-16 border border-slate-300 rounded px-1 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-400" />
      <button type="button" onClick={guardar} disabled={pending}
        title="Guardar" className="px-1 py-0.5 rounded text-[11px] bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
        {pending ? "…" : "✓"}
      </button>
      <button type="button" onClick={cerrar} disabled={pending}
        title="Cancelar" className="px-1 py-0.5 rounded text-[11px] border border-slate-300 text-slate-500 hover:bg-slate-50">✕</button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </span>
  );
}

function Card({ title, value, hint }: { title: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}
