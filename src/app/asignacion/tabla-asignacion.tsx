"use client";
// Tabla de la lista de asignación. La paginación sigue en el server component
// (page.tsx) vía ?page=; aquí solo pintamos las filas que ya llegaron, pero como
// client component para poder hacer la fila clickeable (abre la clase) y mostrar
// un botón "Abrir" fijo a la derecha que no se pierde al scrollear en horizontal.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Estado, Fuerza, TipoClase, planCorto, plantelCorto } from "@/lib/ui";
import { marcarNoApertura, reactivarSlot } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";

export type SlotFila = {
  id: number;
  plantel: string;
  materia: string | null;
  plan: string | null;
  cuatrimestre: number | string | null;
  tipo: string | null;
  grupo: string | null;
  alumnos: number | null;
  aula: string | null;
  dia: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  docente: string | null;
  estado: string | null;
  puntaje: number | null;
  razon: string | null;
};

// `parked` = true cuando estamos viendo la pestaña "No se abren": entonces cada fila
// muestra "Reactivar" en vez de "No abre".
export function TablaAsignacion({ rows, parked = false }: { rows: SlotFila[]; parked?: boolean }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
        <thead className="bg-slate-50 text-slate-600">
          <tr className="text-left">
            <th className="px-4 py-2 font-medium hidden md:table-cell">Plantel</th>
            <th className="px-4 py-2 font-medium">Materia</th>
            <th className="px-4 py-2 font-medium hidden 2xl:table-cell">Plan</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Cuatri</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Tipo</th>
            <th className="px-4 py-2 font-medium">Grupo</th>
            <th className="px-4 py-2 font-medium text-right hidden 2xl:table-cell">Alumnos</th>
            <th className="px-4 py-2 font-medium hidden 2xl:table-cell">Aula</th>
            <th className="px-4 py-2 font-medium hidden 2xl:table-cell">Horario</th>
            <th className="px-4 py-2 font-medium">Docente</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-2 py-2 font-medium text-right sticky right-0 bg-slate-50"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((s) => (
            <tr
              key={s.id}
              onClick={() => router.push(`/asignacion/${s.id}`)}
              className="hover:bg-slate-50 cursor-pointer group"
            >
              <td className="px-4 py-2 text-slate-500 hidden md:table-cell">{plantelCorto(s.plantel)}</td>
              <td className="px-4 py-2 text-slate-800">{s.materia ?? "—"}</td>
              <td className="px-4 py-2 text-slate-600 hidden 2xl:table-cell">{planCorto(s.plan)}</td>
              <td className="px-4 py-2 text-slate-600 hidden lg:table-cell">{s.cuatrimestre ?? "—"}</td>
              <td className="px-4 py-2 hidden lg:table-cell"><TipoClase t={s.tipo} /></td>
              <td className="px-4 py-2 text-slate-600">{s.grupo ?? "—"}</td>
              <td className="px-4 py-2 text-right text-slate-600 hidden 2xl:table-cell">{s.alumnos ?? <span className="text-slate-300">—</span>}</td>
              <td className="px-4 py-2 text-slate-600 hidden 2xl:table-cell">{s.aula ?? <span className="text-slate-300">—</span>}</td>
              <td className="px-4 py-2 text-slate-600 hidden 2xl:table-cell">{s.dia && s.dia !== "N/A" && s.hora_inicio && s.hora_fin ? `${s.dia} ${s.hora_inicio}-${s.hora_fin}` : <span className="text-slate-300">—</span>}</td>
              <td className="px-4 py-2 text-slate-700">
                {s.docente
                  ? <div className="flex flex-col gap-0.5">
                      <span>{s.docente}</span>
                      {s.estado === "sugerida" && <Fuerza puntaje={s.puntaje} razon={s.razon} />}
                    </div>
                  : <span className="text-slate-400">sin docente</span>}
              </td>
              <td className="px-4 py-2"><Estado e={s.estado} /></td>
              <td
                className="px-2 py-2 text-right sticky right-0 bg-white group-hover:bg-slate-50"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-end gap-1.5">
                  <Link
                    href={`/asignacion/${s.id}`}
                    className="inline-block px-2.5 py-1 rounded-md border border-slate-300 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Abrir
                  </Link>
                  {parked ? (
                    <form action={reactivarSlot.bind(null, s.id)}>
                      <button className="inline-block px-2.5 py-1 rounded-md border border-green-300 bg-green-50 text-xs text-green-700 hover:bg-green-100 whitespace-nowrap">
                        Reactivar
                      </button>
                    </form>
                  ) : (
                    <form action={marcarNoApertura.bind(null, s.id)}>
                      <ConfirmButton
                        message={`¿Marcar "${s.materia ?? "esta clase"}"${s.grupo ? ` · ${s.grupo}` : ""} como que NO se apertura?\n\nSe oculta de la lista y deja de contar. No se borra: puedes recuperarla en la pestaña "No se abren".`}
                        className="inline-block px-2.5 py-1 rounded-md border border-slate-300 text-xs text-slate-500 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300 whitespace-nowrap"
                      >
                        No abre
                      </ConfirmButton>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={12} className="px-4 py-6 text-center text-sm text-slate-400">
                Sin resultados con estos filtros.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
