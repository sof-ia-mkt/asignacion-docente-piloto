import Link from "next/link";
import { getMaterias } from "@/lib/queries";
import { nombresCoordinadores } from "@/lib/usuarios-db";
import { NuevoDocenteForm } from "./form";

export default async function NuevoDocentePage() {
  const [materias, coordinadores] = await Promise.all([getMaterias(), nombresCoordinadores()]);
  return (
    <div className="space-y-4">
      <Link href="/profesores" className="text-sm text-blue-700 hover:underline">← Profesores</Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Nuevo docente</h1>
        <p className="text-sm text-slate-500">
          Captura sus datos y define qué materias puede dar. Aparecerá como candidato en esas materias.
        </p>
      </div>
      <NuevoDocenteForm materias={materias} coordinadores={coordinadores} />
    </div>
  );
}
