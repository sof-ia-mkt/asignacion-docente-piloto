import { getAulas } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";

export default async function AulasPage() {
  const { aulas, resumen } = await getAulas();
  const teoria = aulas.filter((a) => a.tipo === "Teoría");
  const practica = aulas.filter((a) => a.tipo === "Práctica");
  const otras = aulas.filter((a) => a.tipo !== "Teoría" && a.tipo !== "Práctica");

  const Tabla = ({ titulo, lista }: { titulo: string; lista: typeof aulas }) => (
    <Panel title={`${titulo} (${lista.length})`}>
      {lista.length === 0 ? (
        <p className="text-sm text-slate-400">Sin aulas.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-slate-500 text-left">
            <tr><th className="py-1 font-medium">Aula</th><th className="py-1 font-medium text-right">Capacidad</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lista.map((a) => (
              <tr key={a.id}>
                <td className="py-1.5 text-slate-800">{a.clave}</td>
                <td className="py-1.5 text-right text-slate-600">{a.capacidad ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Aulas</h1>
        <p className="text-sm text-slate-500">Catálogo de salones del plantel y su capacidad.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Aulas totales" value={aulas.length} />
        <Card title="De teoría" value={teoria.length} />
        <Card title="De práctica / labs" value={practica.length} />
        <Card title="Grupo más grande" value={resumen.alumnos_max} hint="alumnos" />
      </div>

      <Panel>
        <p className="text-sm text-slate-600">
          El aula de teoría más grande es de <b>{resumen.cap_teoria}</b> y la de práctica de <b>{resumen.cap_practica}</b>.
          El grupo más numeroso tiene <b>{resumen.alumnos_max}</b> alumnos, así que el cupo alcanza:
          la plataforma podrá <b>recomendar el aula</b> cruzando alumnos contra capacidad y tipo de clase.
        </p>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <Tabla titulo="Aulas de teoría" lista={teoria} />
        <Tabla titulo="Aulas de práctica / laboratorios" lista={practica} />
      </div>
      {otras.length > 0 && <Tabla titulo="Otras" lista={otras} />}
    </div>
  );
}
