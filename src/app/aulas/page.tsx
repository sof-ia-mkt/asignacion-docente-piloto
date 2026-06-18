import { getAulas } from "@/lib/queries";
import { Card, Panel } from "@/lib/ui";
import { ExportButtons } from "@/lib/export-buttons";
import { CrearAulaForm } from "./crear-form";
import { TablaAulas } from "./tabla-aulas";

export default async function AulasPage() {
  const { aulas, resumen } = await getAulas();
  const teoria = aulas.filter((a) => a.tipo === "Teoría");
  const practica = aulas.filter((a) => a.tipo === "Práctica");
  const otras = aulas.filter((a) => a.tipo !== "Teoría" && a.tipo !== "Práctica");
  // Tipos ya existentes, para el datalist del alta (sugerencias sin obligar).
  const tipos = [...new Set(aulas.map((a) => a.tipo).filter((t): t is string => !!t))].sort();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Aulas</h1>
          <p className="text-sm text-slate-500">Catálogo de salones (todos los planteles). Edita tipo y capacidad, o agrega y borra salones.</p>
        </div>
        <ExportButtons tipo="aulas" className="shrink-0" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Aulas totales" value={aulas.length}
          hint={otras.length ? `${teoria.length} teoría · ${practica.length} práctica · ${otras.length} sin tipo` : `${teoria.length} teoría · ${practica.length} práctica`} />
        <Card title="De teoría" value={teoria.length} />
        <Card title="De práctica / labs" value={practica.length} />
        <Card title="Grupo más grande" value={resumen.alumnos_max} hint="alumnos" />
      </div>

      <Panel title="Agregar un salón">
        <CrearAulaForm tipos={tipos} />
      </Panel>

      <Panel>
        <p className="text-sm text-slate-600">
          El aula de teoría más grande es de <b>{resumen.cap_teoria}</b> y la de práctica de <b>{resumen.cap_practica}</b>.
          El grupo más numeroso tiene <b>{resumen.alumnos_max}</b> alumnos, así que el cupo alcanza:
          la plataforma podrá <b>recomendar el aula</b> cruzando alumnos contra capacidad y tipo de clase.
        </p>
      </Panel>

      {resumen.sin_capacidad > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>{resumen.sin_capacidad} aula{resumen.sin_capacidad === 1 ? "" : "s"} sin capacidad registrada.</b>{" "}
          El acomodo automático de salones las <b>ignora</b> (no sabe cuántos alumnos caben) y no cuentan
          para el aula más grande. Captura su capacidad abajo (filas en ámbar) para que la plataforma pueda usarlas.
        </div>
      )}

      {/* Datalist compartido para los selects de tipo en las filas editables. */}
      <datalist id="tipos-aula-edit">{tipos.map((t) => <option key={t} value={t} />)}</datalist>

      <div className="grid md:grid-cols-2 gap-4">
        <TablaAulas titulo="Aulas de teoría" lista={teoria} />
        <TablaAulas titulo="Aulas de práctica / laboratorios" lista={practica} />
      </div>
      {otras.length > 0 && <TablaAulas titulo="Sin tipo (captura teoría o práctica para que el acomodo las use)" lista={otras} />}
    </div>
  );
}
