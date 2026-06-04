import Link from "next/link";

// 404 amable. Se muestra cuando una página llama a notFound() (p. ej. un docente o
// una clase cuyo id no existe) o ante una URL inexistente.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-sm font-medium text-slate-400">404</p>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">No encontramos esto</h1>
      <p className="mt-3 text-sm text-slate-600">
        La página, el docente o la clase que buscas no existe o fue eliminada.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2">
        <Link href="/" className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm hover:bg-slate-800">
          Ir al inicio
        </Link>
        <Link href="/asignacion" className="px-4 py-2 rounded-md border border-slate-200 text-sm text-slate-700 hover:border-slate-300">
          Ver asignación
        </Link>
      </div>
    </div>
  );
}
