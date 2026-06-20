import {
  getCandidatosCompactacion, getCompactacionesActivas, getDocentesParaMateria,
  getSlotsLibresParaMateria,
  type DocenteCandidato, type CompactGrupo,
} from "@/lib/queries";
import { CompactacionCliente } from "./cliente";

// Pantalla de Compactación — FASE 2 (detector + acción).
// Compactar = juntar en UNA sola clase (un docente, un aula, un horario) la misma materia
// que se abre en varios grupos/carreras del mismo plantel. Todo es ADITIVO y REVERSIBLE:
// crear una compactación liga slots a un contenedor; "Separar" los vuelve a soltar.
export default async function CompactacionPage() {
  const [candidatos, compactaciones] = await Promise.all([
    getCandidatosCompactacion(),
    getCompactacionesActivas(),
  ]);

  // Docentes recomendados por materia candidata (para el selector "asignar docente" al compactar).
  const materiaIds = [...new Set(candidatos.map((c) => c.materia_id))];
  const pares = await Promise.all(
    materiaIds.map(async (id) => [id, await getDocentesParaMateria(id)] as const),
  );
  const docentesPorMateria: Record<number, DocenteCandidato[]> = Object.fromEntries(pares);

  // Grupos sueltos (sin compactar) por materia+plantel: para "Agregar grupos" a una clase ya hecha.
  const claves = [...new Set(
    compactaciones
      .filter((c) => c.materia_id != null && c.plantel != null)
      .map((c) => `${c.materia_id}|${c.plantel}`),
  )];
  const paresLibres = await Promise.all(
    claves.map(async (k) => {
      const [mid, plantel] = k.split("|");
      return [k, await getSlotsLibresParaMateria(Number(mid), plantel)] as const;
    }),
  );
  const libresPorClave: Record<string, CompactGrupo[]> = Object.fromEntries(paresLibres);

  return (
    <CompactacionCliente
      candidatos={candidatos}
      compactaciones={compactaciones}
      docentesPorMateria={docentesPorMateria}
      libresPorClave={libresPorClave}
    />
  );
}
