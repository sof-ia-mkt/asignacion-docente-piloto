"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { plantelCorto, planCorto, tipoLabel } from "@/lib/ui";

type Conteo = { total: number; sin: number; con: number; rev: number; parked: number };

// Barra de filtros de la pantalla de Asignación (Opción C):
//  - Control segmentado por estado (Todas / Sin docente / Por revisar / Confirmadas) con conteos.
//    Las tres cubetas de trabajo son disjuntas y suman el total: Sin docente (sin candidato puesto),
//    Por revisar (sugerencia automática pendiente de coordinación), Confirmadas (ya revisadas).
//  - Buscador + tres menús desplegables (plantel, cuatrimestre, tipo).
//  - Pastillas quitables que muestran los filtros activos.
// Toda la navegación se hace por URL (searchParams) para que sea compartible y
// que el server vuelva a consultar. Cambiar cualquier filtro reinicia a la página 1.
export function AsignacionFiltros({
  estado, plantel, cuatri, tipo, qstr, plan, turno, modalidad, comp,
  planteles, cuatris, tipos, carreras, turnos, modalidades, conteo,
}: {
  estado: string; plantel: string; cuatri: string; tipo: string; qstr: string;
  plan: string; turno: string; modalidad: string; comp: string;
  planteles: { plantel: string; n: number }[];
  cuatris: string[]; tipos: string[]; carreras: string[]; turnos: string[]; modalidades: string[];
  conteo: Conteo;
}) {
  const router = useRouter();
  const [q, setQ] = useState(qstr);
  // Si el buscador se limpia desde una pastilla (cambia qstr), sincroniza el input.
  // Se ajusta en render (patrón recomendado por React) en vez de en un efecto.
  const [prevQstr, setPrevQstr] = useState(qstr);
  if (qstr !== prevQstr) {
    setPrevQstr(qstr);
    setQ(qstr);
  }

  // Arma la URL con los filtros actuales + los cambios pedidos. Omite 'page' a
  // propósito: cualquier cambio de filtro debe regresar a la primera página.
  const build = (cambios: Record<string, string>) => {
    const cur: Record<string, string> = {};
    if (estado) cur.estado = estado;
    if (plantel) cur.plantel = plantel;
    if (cuatri) cur.cuatri = cuatri;
    if (tipo) cur.tipo = tipo;
    if (plan) cur.plan = plan;
    if (turno) cur.turno = turno;
    if (modalidad) cur.modalidad = modalidad;
    if (comp) cur.comp = comp;
    if (qstr) cur.q = qstr;
    const merged = { ...cur, ...cambios };
    const limpio = Object.fromEntries(Object.entries(merged).filter(([, v]) => v));
    const qs = new URLSearchParams(limpio).toString();
    return `/asignacion${qs ? `?${qs}` : ""}`;
  };
  const go = (cambios: Record<string, string>) => router.push(build(cambios));

  const sel = "rounded-md border border-slate-200 bg-white text-sm text-slate-700 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-300 hover:border-slate-300";

  const segmentos = [
    { v: "", label: "Todas", n: conteo.total },
    { v: "sin_asignar", label: "Sin propuesta", n: conteo.sin },
    { v: "por_revisar", label: "Por revisar", n: conteo.rev },
    { v: "asignado", label: "Aprobadas", n: conteo.con },
    // "No se abren": solo aparece cuando hay clases parqueadas (o si la estás viendo),
    // para no estorbar cuando no se usa.
    ...(conteo.parked > 0 || estado === "no_apertura"
      ? [{ v: "no_apertura", label: "No se abren", n: conteo.parked }]
      : []),
  ];

  const pills: { label: string; clear: Record<string, string> }[] = [];
  if (plantel) pills.push({ label: plantelCorto(plantel), clear: { plantel: "" } });
  if (cuatri) pills.push({ label: `Cuatri ${cuatri}`, clear: { cuatri: "" } });
  if (tipo) pills.push({ label: tipoLabel(tipo), clear: { tipo: "" } });
  if (plan) pills.push({ label: planCorto(plan), clear: { plan: "" } });
  if (turno) pills.push({ label: `Turno ${turno}`, clear: { turno: "" } });
  if (modalidad) pills.push({ label: modalidad, clear: { modalidad: "" } });
  if (comp) pills.push({ label: comp === "si" ? "Compactadas" : "Sin compactar", clear: { comp: "" } });
  if (qstr) pills.push({ label: `"${qstr}"`, clear: { q: "" } });

  return (
    <div className="space-y-3">
      {/* Eje principal de trabajo: qué falta por asignar */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {segmentos.map((s) => {
          const activo = estado === s.v;
          return (
            <button key={s.v || "todas"} type="button" onClick={() => go({ estado: s.v })}
              className={`px-3.5 py-1.5 rounded-md text-sm transition ${activo ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
              {s.label} <span className={activo ? "text-slate-300" : "text-slate-400"}>· {s.n}</span>
            </button>
          );
        })}
      </div>

      {/* Búsqueda + menús desplegables compactos */}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); go({ q }); }} className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar materia o grupo…"
            className="rounded-md border border-slate-200 text-sm px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <button type="submit" className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm">Buscar</button>
        </form>

        <select value={plantel} onChange={(e) => go({ plantel: e.target.value })} className={sel} aria-label="Plantel">
          <option value="">Todos los planteles</option>
          {planteles.map((p) => (
            <option key={p.plantel} value={p.plantel}>{plantelCorto(p.plantel)} ({p.n})</option>
          ))}
        </select>

        <select value={cuatri} onChange={(e) => go({ cuatri: e.target.value })} className={sel} aria-label="Cuatrimestre">
          <option value="">Todos los cuatrimestres</option>
          {cuatris.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select value={tipo} onChange={(e) => go({ tipo: e.target.value })} className={sel} aria-label="Tipo de clase">
          <option value="">Todos los tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{tipoLabel(t)}</option>)}
        </select>

        {carreras.length > 0 && (
          <select value={plan} onChange={(e) => go({ plan: e.target.value })} className={sel} aria-label="Carrera">
            <option value="">Todas las carreras</option>
            {carreras.map((c) => <option key={c} value={c}>{planCorto(c)}</option>)}
          </select>
        )}

        {turnos.length > 0 && (
          <select value={turno} onChange={(e) => go({ turno: e.target.value })} className={sel} aria-label="Turno">
            <option value="">Todos los turnos</option>
            {turnos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}

        {modalidades.length > 0 && (
          <select value={modalidad} onChange={(e) => go({ modalidad: e.target.value })} className={sel} aria-label="Modalidad">
            <option value="">Todas las modalidades</option>
            {modalidades.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}

        <select value={comp} onChange={(e) => go({ comp: e.target.value })} className={sel} aria-label="Compactación">
          <option value="">Compactadas y normales</option>
          <option value="si">Solo compactadas</option>
          <option value="no">Sin compactar</option>
        </select>
      </div>

      {/* Filtros activos: pastillas quitables */}
      {pills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">Filtros:</span>
          {pills.map((p, i) => (
            <button key={i} type="button" onClick={() => go(p.clear)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-sm hover:bg-slate-200"
              title="Quitar este filtro">
              {p.label} <span className="text-slate-400" aria-hidden>✕</span>
            </button>
          ))}
          {pills.length > 1 && (
            <button type="button" onClick={() => go({ plantel: "", cuatri: "", tipo: "", plan: "", turno: "", modalidad: "", comp: "", q: "" })}
              className="text-xs text-blue-700 hover:underline ml-1">Limpiar todo</button>
          )}
        </div>
      )}
    </div>
  );
}
