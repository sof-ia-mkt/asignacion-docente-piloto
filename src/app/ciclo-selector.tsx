"use client";
import { useRef } from "react";
import { seleccionarCiclo } from "@/app/actions";

type CicloOpt = { codigo: string; nombre: string; estado: string };

// Selector global de ciclo en el header. Al cambiar la opción, envía el form (server action)
// que guarda la cookie y revalida todas las páginas. Sin botón: cambia y se aplica.
export function CicloSelector({ ciclos, activo }: { ciclos: CicloOpt[]; activo: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const etiqueta = (c: CicloOpt) =>
    `${c.nombre}${c.estado === "planeacion" ? " · en curso" : " · historial"}`;
  return (
    <form action={seleccionarCiclo} ref={formRef} className="ml-auto flex items-center gap-2">
      <span className="text-xs text-slate-400">Ciclo:</span>
      <select
        // key={activo}: cuando la server action cambia el ciclo activo y revalida el layout,
        // el select se REMONTA con el nuevo valor. Sin esto, al ser no controlado (defaultValue
        // solo aplica al montar) el dropdown se regresaba solo al ciclo anterior y parecía
        // que "no dejaba cambiar", aunque la cookie y los datos sí cambiaban.
        key={activo}
        name="ciclo"
        defaultValue={activo}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-md border border-slate-700 bg-slate-800 text-slate-100 text-sm px-2 py-1
                   focus:outline-none focus:ring-2 focus:ring-slate-500"
      >
        {ciclos.map((c) => (
          <option key={c.codigo} value={c.codigo}>{etiqueta(c)}</option>
        ))}
      </select>
    </form>
  );
}
