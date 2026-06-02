import Link from "next/link";
import { getPlanteles, getMaterias, getGrupos } from "@/lib/queries";
import { NuevaMateriaForm } from "./form";

export default async function NuevaMateriaPage() {
  const [planteles, materias, grupos] = await Promise.all([
    getPlanteles(), getMaterias(), getGrupos(),
  ]);
  return (
    <div className="space-y-4">
      <Link href="/asignacion" className="text-sm text-blue-700 hover:underline">← Asignación</Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Nueva materia por grupo</h1>
        <p className="text-sm text-slate-500">
          Agrega una clase del ciclo de septiembre que falte. Luego podrás asignarle docente y aula.
        </p>
      </div>
      <NuevaMateriaForm planteles={planteles} materias={materias} grupos={grupos} />
    </div>
  );
}
