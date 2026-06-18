// Ciclo seleccionado por coordinación. Reemplaza el viejo truco binario es_historial:
//   - "ciclo activo"  = el que se está viendo/asignando (lo elige el selector del header).
//   - "ciclos historial" = los cerrados (estado='historial'); alimentan la recomendación
//     ("ya dio esta materia antes"). Crece con el tiempo: cada ciclo que se cierra suma señal.
//
// Solo se importa desde código de servidor (lee cookie con next/headers). `cache` de React
// memoiza por request, así que aunque muchas queries pidan el ciclo activo, se resuelve 1 vez.
import { cookies } from "next/headers";
import { cache } from "react";
import { q } from "./db";

export type Ciclo = {
  id: number; codigo: string; nombre: string;
  estado: string; es_activo: boolean; orden: number;
};

// Todos los ciclos, más reciente arriba (para el menú del selector).
export const getCiclos = cache(async (): Promise<Ciclo[]> =>
  q<Ciclo>(`select id, codigo, nombre, estado, es_activo, orden
              from ciclos order by orden desc, id desc`));

// El ciclo que el coordinador está viendo: cookie 'ciclo' (código) si es válida;
// si no, el marcado es_activo; si no, el de mayor orden. Nunca null (siempre hay ciclos).
export const cicloActivo = cache(async (): Promise<Ciclo> => {
  const ciclos = await getCiclos();
  const sel = (await cookies()).get("ciclo")?.value;
  return (
    ciclos.find((c) => c.codigo === sel) ??
    ciclos.find((c) => c.es_activo) ??
    ciclos[0]
  );
});

// IDs de los ciclos que cuentan como HISTORIAL (cerrados) para la recomendación.
// Independiente de cuál esté seleccionado: el historial es el mismo se mire lo que se mire.
export const ciclosHistorial = cache(async (): Promise<number[]> => {
  const ciclos = await getCiclos();
  return ciclos.filter((c) => c.estado === "historial").map((c) => c.id);
});

// Fragmento SQL "está en el historial": para la columna ciclo_id indicada (ej. "s.ciclo_id").
// Los ids son enteros de NUESTRA tabla, no entran del usuario -> interpolarlos es seguro.
// Lista vacía -> "in (-1)" (no empata con nada), evita el SQL inválido "in ()".
export const sqlEnHistorial = (ids: number[], col = "s.ciclo_id"): string =>
  `${col} in (${ids.length ? ids.join(",") : "-1"})`;
