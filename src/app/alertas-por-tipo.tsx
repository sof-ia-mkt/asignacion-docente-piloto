"use client";

// Panel "Alertas por tipo" con acordeón. Cada renglón tiene DOS acciones:
//  - flecha + nombre  -> despliega qué significa la alerta y un ejemplo (toggle local)
//  - número           -> enlaza a la lista de esas alertas (/alertas?tipo=...) para resolverlas
// Las explicaciones viven en ui.tsx (ALERTA_INFO): fuente única, sin duplicar.
import { useState } from "react";
import Link from "next/link";
import { tipoLabel, ALERTA_INFO } from "@/lib/ui";

export function AlertasPorTipo({ alertas }: { alertas: { tipo: string; n: number }[] }) {
  const [abierto, setAbierto] = useState<string | null>(null);

  if (alertas.length === 0) return <p className="text-sm text-slate-400">Sin alertas.</p>;

  return (
    <ul className="divide-y divide-slate-100">
      {alertas.map((a) => {
        const info = ALERTA_INFO[a.tipo];
        const open = abierto === a.tipo;
        // severidad=todas para que el conteo de la lista coincida con el número que se muestra aquí.
        const href = `/alertas?tipo=${encodeURIComponent(a.tipo)}&severidad=todas`;
        return (
          <li key={a.tipo}>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setAbierto(open ? null : a.tipo)}
                aria-expanded={open}
                disabled={!info}
                className="flex flex-1 items-center gap-1.5 py-2 text-left text-slate-700 disabled:cursor-default"
              >
                {info && (
                  <span
                    className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
                    aria-hidden
                  >
                    ▸
                  </span>
                )}
                {tipoLabel(a.tipo)}
              </button>
              <Link
                href={href}
                title={`Ver y resolver las ${a.n} de "${tipoLabel(a.tipo)}"`}
                className="ml-2 rounded px-2 py-1 font-semibold text-slate-900 hover:bg-slate-100 hover:text-blue-700"
              >
                {a.n}
              </Link>
            </div>
            {open && info && (
              <div className="pb-3 pl-5 pr-2 text-xs text-slate-600">
                <p>{info.que}</p>
                <p className="mt-1 italic text-slate-500">{info.ejemplo}</p>
                <Link href={href} className="mt-1.5 inline-block text-blue-700 hover:underline">
                  Ver las {a.n} y resolverlas →
                </Link>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
