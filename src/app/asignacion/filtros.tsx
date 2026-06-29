"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { plantelCorto, planCorto, tipoLabel } from "@/lib/ui";

type Conteo = { total: number; sin: number; con: number; rev: number; parked: number };

// Menú desplegable con casillas (multi-selección) para un filtro de "unión".
// Cada casilla marcada agrega su valor al filtro (OR); navega al instante (igual que el
// resto de filtros, todo por URL). El menú se mantiene abierto para marcar varias seguidas
// y se cierra al hacer clic fuera. El resumen del botón muestra: nada → placeholder,
// 1 → la etiqueta, 2+ → "Plural: N".
function MultiCheck({
  id, openKey, setOpenKey, ariaLabel, placeholder, countLabel, options, selected, format, onToggle, onClear, className,
}: {
  id: string;
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
  ariaLabel: string;
  placeholder: string;
  countLabel: string;
  options: string[];
  selected: string[];
  format: (v: string) => string;
  onToggle: (value: string) => void;
  onClear: () => void;
  className: string;
}) {
  // Solo un menú abierto a la vez: lo controla el padre (openKey). Así es robusto con mouse
  // y teclado (abrir otro cierra el anterior, sin depender de un clic-fuera).
  const open = openKey === id;
  const ref = useRef<HTMLDivElement>(null);
  // Clic fuera del menú → cerrar. Sólo escucha mientras está abierto.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenKey(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, setOpenKey]);

  const sel = new Set(selected);
  const activo = selected.length > 0;
  const resumen =
    selected.length === 0 ? placeholder
      : selected.length === 1 ? format(selected[0])
        : `${countLabel}: ${selected.length}`;

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label={ariaLabel} aria-expanded={open}
        onClick={() => setOpenKey(open ? null : id)}
        className={`${className} inline-flex items-center gap-1.5 ${activo ? "border-slate-400 text-slate-900 font-medium" : ""}`}>
        <span className="max-w-[14rem] truncate">{resumen}</span>
        <span className="text-slate-400" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          {options.map((o) => (
            <label key={o}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" checked={sel.has(o)} onChange={() => onToggle(o)}
                className="h-4 w-4 rounded border-slate-300 accent-slate-900" />
              <span className="truncate">{format(o)}</span>
            </label>
          ))}
          {activo && (
            <button type="button" onClick={onClear}
              className="mt-1 w-full text-left px-2 py-1.5 text-xs text-blue-700 hover:underline">
              Limpiar selección
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Barra de filtros de la pantalla de Asignación (Opción C):
//  - Control segmentado por estado (Todas / Sin docente / Por revisar / Confirmadas) con conteos.
//    Las tres cubetas de trabajo son disjuntas y suman el total: Sin docente (sin candidato puesto),
//    Por revisar (sugerencia automática pendiente de coordinación), Confirmadas (ya revisadas).
//  - Buscador + menús desplegables. Plantel y Cuatrimestre son de selección única; Tipo, Carrera,
//    Turno y Modalidad son de selección MÚLTIPLE (casillas): se muestra la unión de lo marcado.
//  - Pastillas quitables que muestran los filtros activos (una por valor en los multi-valor).
// Toda la navegación se hace por URL (searchParams) para que sea compartible y
// que el server vuelva a consultar. Cambiar cualquier filtro reinicia a la página 1.
// Los filtros multi-valor viajan en la URL como lista separada por comas (los valores no llevan comas).
export function AsignacionFiltros({
  estado, plantel, cuatri, tipo, qstr, plan, turno, modalidad, comp,
  planteles, cuatris, tipos, carreras, turnos, modalidades, conteo,
}: {
  estado: string; plantel: string; cuatri: string; tipo: string[]; qstr: string;
  plan: string[]; turno: string[]; modalidad: string[]; comp: string;
  planteles: { plantel: string; n: number }[];
  cuatris: string[]; tipos: string[]; carreras: string[]; turnos: string[]; modalidades: string[];
  conteo: Conteo;
}) {
  const router = useRouter();
  const [q, setQ] = useState(qstr);
  // Cuál de los menús de casillas está abierto (uno a la vez). null = ninguno.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Si el buscador se limpia desde una pastilla (cambia qstr), sincroniza el input.
  // Se ajusta en render (patrón recomendado por React) en vez de en un efecto.
  const [prevQstr, setPrevQstr] = useState(qstr);
  if (qstr !== prevQstr) {
    setPrevQstr(qstr);
    setQ(qstr);
  }

  // Arma la URL con los filtros actuales + los cambios pedidos. Omite 'page' a
  // propósito: cualquier cambio de filtro debe regresar a la primera página.
  // Los multi-valor (tipo/plan/turno/modalidad) se serializan como lista con comas.
  const build = (cambios: Record<string, string>) => {
    const cur: Record<string, string> = {};
    if (estado) cur.estado = estado;
    if (plantel) cur.plantel = plantel;
    if (cuatri) cur.cuatri = cuatri;
    if (tipo.length) cur.tipo = tipo.join(",");
    if (plan.length) cur.plan = plan.join(",");
    if (turno.length) cur.turno = turno.join(",");
    if (modalidad.length) cur.modalidad = modalidad.join(",");
    if (comp) cur.comp = comp;
    if (qstr) cur.q = qstr;
    const merged = { ...cur, ...cambios };
    const limpio = Object.fromEntries(Object.entries(merged).filter(([, v]) => v));
    const qs = new URLSearchParams(limpio).toString();
    return `/asignacion${qs ? `?${qs}` : ""}`;
  };
  const go = (cambios: Record<string, string>) => router.push(build(cambios));

  // Marca/desmarca un valor de un filtro multi-valor y navega (unión). Lista vacía → quita el filtro.
  const toggle = (key: "tipo" | "plan" | "turno" | "modalidad", current: string[], value: string) => {
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    go({ [key]: next.join(",") });
  };

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

  // Pastillas de filtros activos. En los multi-valor hay UNA pastilla por valor; al quitarla
  // se reconstruye la lista sin ese valor (lista vacía → quita el filtro).
  const pills: { label: string; clear: Record<string, string> }[] = [];
  if (plantel) pills.push({ label: plantelCorto(plantel), clear: { plantel: "" } });
  if (cuatri) pills.push({ label: `Cuatri ${cuatri}`, clear: { cuatri: "" } });
  for (const t of tipo) pills.push({ label: tipoLabel(t), clear: { tipo: tipo.filter((x) => x !== t).join(",") } });
  for (const c of plan) pills.push({ label: planCorto(c), clear: { plan: plan.filter((x) => x !== c).join(",") } });
  for (const t of turno) pills.push({ label: `Turno ${t}`, clear: { turno: turno.filter((x) => x !== t).join(",") } });
  for (const m of modalidad) pills.push({ label: m, clear: { modalidad: modalidad.filter((x) => x !== m).join(",") } });
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

      {/* Búsqueda + menús desplegables compactos (selección única y múltiple) */}
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

        <MultiCheck id="tipo" openKey={openKey} setOpenKey={setOpenKey}
          ariaLabel="Tipo de clase" placeholder="Todos los tipos" countLabel="Tipos"
          options={tipos} selected={tipo} format={tipoLabel} className={sel}
          onToggle={(v) => toggle("tipo", tipo, v)} onClear={() => go({ tipo: "" })} />

        {carreras.length > 0 && (
          <MultiCheck id="plan" openKey={openKey} setOpenKey={setOpenKey}
            ariaLabel="Carrera" placeholder="Todas las carreras" countLabel="Carreras"
            options={carreras} selected={plan} format={planCorto} className={sel}
            onToggle={(v) => toggle("plan", plan, v)} onClear={() => go({ plan: "" })} />
        )}

        {turnos.length > 0 && (
          <MultiCheck id="turno" openKey={openKey} setOpenKey={setOpenKey}
            ariaLabel="Turno" placeholder="Todos los turnos" countLabel="Turnos"
            options={turnos} selected={turno} format={(t) => t} className={sel}
            onToggle={(v) => toggle("turno", turno, v)} onClear={() => go({ turno: "" })} />
        )}

        {modalidades.length > 0 && (
          <MultiCheck id="modalidad" openKey={openKey} setOpenKey={setOpenKey}
            ariaLabel="Modalidad" placeholder="Todas las modalidades" countLabel="Modalidades"
            options={modalidades} selected={modalidad} format={(m) => m} className={sel}
            onToggle={(v) => toggle("modalidad", modalidad, v)} onClear={() => go({ modalidad: "" })} />
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
