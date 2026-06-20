"use client";
// Tabla de alertas con "mostrar de a poco": evita el scroll infinito cuando hay
// muchas alertas (p. ej. 94 de severidad alta). La lista completa llega como prop
// desde el server component; aquí solo se controla cuántas filas se pintan.
import { useState } from "react";
import Link from "next/link";
import { Sev, tipoLabel, plantelCorto } from "@/lib/ui";

export type AlertaFila = {
  id: number; tipo: string; severidad: string; detalle: string;
  slot_id: number | null; profesor_id: number | null; profesor: string | null; plantel: string | null;
  materia: string | null; grupo: string | null;
  dia: string | null; hora_inicio: string | null; hora_fin: string | null;
};

const POR_PAGINA = 25;

export function TablaAlertas({ alertas }: { alertas: AlertaFila[] }) {
  const [visibles, setVisibles] = useState(POR_PAGINA);

  // Si cambian los filtros (llega otra lista), reiniciamos al primer bloque. Se ajusta
  // durante el render (patrón recomendado por React) en vez de en un efecto.
  const [prevAlertas, setPrevAlertas] = useState(alertas);
  if (alertas !== prevAlertas) {
    setPrevAlertas(alertas);
    setVisibles(POR_PAGINA);
  }

  const mostrados = alertas.slice(0, visibles);
  const faltan = alertas.length - mostrados.length;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Prioridad</th>
              <th className="px-3 py-2 font-medium">Clase</th>
              <th className="px-3 py-2 font-medium">Cuándo</th>
              <th className="px-3 py-2 font-medium">Plantel</th>
              <th className="px-3 py-2 font-medium">Qué pasa</th>
              <th className="px-3 py-2 font-medium">Docente</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mostrados.map((a) => {
              // El docente es el "sujeto" de la alerta solo en estos tipos. En "sin maestro por
              // horario" el profesor es el candidato que NO pudo tomarla (va en "Qué pasa"), no un
              // docente asignado: por eso ahí NO se muestra en esta columna (antes confundía).
              const docenteEsSujeto = ["sobrecarga", "docente_repetido", "traslado_plantel"].includes(a.tipo);
              const dia = a.dia ? a.dia.charAt(0) + a.dia.slice(1).toLowerCase() : null;
              const cuando = dia
                ? `${dia} ${a.hora_inicio ?? ""}${a.hora_fin ? `–${a.hora_fin}` : ""}`.trim()
                : null;
              return (
                <tr key={a.id} className="hover:bg-slate-50 align-top">
                  <td className="px-3 py-3"><Sev s={a.severidad} /></td>
                  <td className="px-3 py-3">
                    {a.materia ? (
                      <>
                        <div className="font-medium text-slate-800">{a.materia}</div>
                        {a.grupo && <div className="text-xs text-slate-400">{a.grupo}</div>}
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{cuando ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{a.plantel ? plantelCorto(a.plantel) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-slate-600 max-w-md">
                    <span className="text-[11px] font-medium text-slate-400">{tipoLabel(a.tipo)}</span>
                    <span className="block">{a.detalle}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {docenteEsSujeto && a.profesor_id ? (
                      <Link href={`/profesores/${a.profesor_id}`} className="text-blue-700 hover:underline">{a.profesor ?? "ver"}</Link>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {a.slot_id && (
                      <Link href={`/asignacion/${a.slot_id}`} className="text-blue-700 hover:underline">Revisar →</Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {alertas.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">Sin alertas con estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {faltan > 0 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setVisibles((v) => v + POR_PAGINA)}
            className="px-4 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
          >
            Mostrar más ({Math.min(POR_PAGINA, faltan)} de {faltan} restantes)
          </button>
          {alertas.length > POR_PAGINA && (
            <button
              type="button"
              onClick={() => setVisibles(alertas.length)}
              className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
            >
              Ver todas ({alertas.length})
            </button>
          )}
        </div>
      )}
      {faltan === 0 && alertas.length > POR_PAGINA && (
        <p className="text-center text-xs text-slate-400">
          Mostrando las {alertas.length}.{" "}
          <button
            type="button"
            onClick={() => setVisibles(POR_PAGINA)}
            className="text-slate-500 hover:text-slate-700 hover:underline"
          >
            Volver a {POR_PAGINA}
          </button>
        </p>
      )}
    </div>
  );
}
