import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfesor, getMaterias } from "@/lib/queries";
import { nombresCoordinadores } from "@/lib/usuarios-db";
import { agregarCandidatura, quitarCandidatura } from "@/app/actions";
import { ConfirmButton } from "@/lib/confirm-button";
import { EditarDocenteForm } from "./form";
import { CVUpload } from "./cv-upload";

export default async function EditarDocentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profId = Number(id);
  const [data, materias, coordinadores] = await Promise.all([getProfesor(profId), getMaterias(), nombresCoordinadores()]);
  if (!data) notFound();
  const { prof, candidatas } = data;

  // Materias del catálogo que aún NO son candidatura de este docente (para el buscador de "agregar").
  const yaCandidata = new Set(candidatas.map((c) => c.materia_id));
  const disponibles = materias.filter((m) => !yaCandidata.has(m.id));

  return (
    <div className="space-y-5">
      <Link href={`/profesores/${profId}`} className="text-sm text-blue-700 hover:underline">← Volver a la ficha</Link>

      <div>
        <h1 className="text-xl font-semibold text-slate-900">Editar docente</h1>
        <p className="text-sm text-slate-500">Corrige sus datos y administra qué materias puede dar.</p>
      </div>

      {/* Datos básicos */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700 mb-4">Datos del docente</h2>
        <EditarDocenteForm prof={prof} coordinadores={coordinadores} />
      </div>

      {/* Leer CV con IA: suma materias candidatas y actualiza sus datos */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">Leer CV con IA</h2>
        <p className="mb-3 text-xs text-slate-400">
          Sube el PDF del CV y Claude deduce qué materias del catálogo puede dar (~$0.05). Suma materias
          candidatas y actualiza sus datos (licenciatura, experiencia, área); no borra lo que ya tiene ni reasigna sus clases.
        </p>
        <CVUpload profesorId={profId} />
      </div>

      {/* Materias que puede dar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">Materias que puede dar</h2>
        <p className="mb-3 text-xs text-slate-400">
          Lo que el sistema usa para recomendarlo. Agregar o quitar materias aquí actualiza las alertas al instante,
          pero NO reasigna sus clases ya puestas.
        </p>

        {candidatas.length === 0 ? (
          <p className="text-sm text-slate-400">No tiene materias registradas. Agrega una abajo.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-md">
            {candidatas.map((c) => (
              <li key={c.materia_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <span className="text-slate-800">{c.materia}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {c.fuente === "historial" ? "ya la impartió / marcada por coordinación" : `CV (${c.fuente})`} · puntaje {c.puntaje}
                  </span>
                </div>
                <form action={quitarCandidatura.bind(null, profId, c.materia_id)}>
                  <ConfirmButton
                    message={`¿Quitar "${c.materia}" de las materias que ${prof.nombre} puede dar? Dejará de recomendarse para esa materia.`}
                    className="text-red-600 hover:underline text-xs whitespace-nowrap">
                    Quitar
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}

        {/* Agregar una materia del catálogo */}
        <form action={agregarCandidatura.bind(null, profId)} className="mt-4 flex flex-wrap items-end gap-2">
          <div className="grow min-w-64">
            <label className="block text-sm font-medium text-slate-700 mb-1">Agregar una materia que puede dar</label>
            <input name="materia" list="materias-disponibles" required
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm"
              placeholder="Escribe el nombre de la materia del catálogo…" />
            <datalist id="materias-disponibles">
              {disponibles.map((m) => <option key={m.id} value={m.nombre} />)}
            </datalist>
          </div>
          <button className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm whitespace-nowrap">Agregar</button>
        </form>
        <p className="mt-1 text-xs text-slate-400">Sólo materias que ya existen en el catálogo. Cuenta como recomendación fuerte (+40).</p>
      </div>
    </div>
  );
}
