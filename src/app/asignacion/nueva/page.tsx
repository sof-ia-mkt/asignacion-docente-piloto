import Link from "next/link";
import { getPlanteles, getMaterias, getGrupos, getDatosNuevoGrupo } from "@/lib/queries";
import { NuevaMateriaForm } from "./form";

export default async function NuevaMateriaPage({
  searchParams,
}: { searchParams: Promise<{ grupo?: string }> }) {
  // ?grupo=nuevo → llega desde el botón "+ Nuevo grupo" de Asignación: el constructor
  // de grupos arranca abierto (crear el grupo es la tarea, la clase viene después).
  const abrirGrupo = (await searchParams).grupo === "nuevo";
  const [planteles, materias, grupos, datosGrupo] = await Promise.all([
    getPlanteles(), getMaterias(), getGrupos(), getDatosNuevoGrupo(),
  ]);
  return (
    <div className="space-y-4">
      <Link href="/asignacion" className="text-sm text-blue-700 hover:underline">← Asignación</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Nueva materia por grupo</h1>
        <p className="text-sm text-slate-500">
          Agrega una clase que falte en el ciclo que estás asignando. Luego podrás asignarle docente y aula.
        </p>
      </div>
      <NuevaMateriaForm planteles={planteles} materias={materias} grupos={grupos} datosGrupo={datosGrupo} abrirGrupo={abrirGrupo} />
    </div>
  );
}
