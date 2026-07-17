"use client";
// Constructor de clave de grupo: la clave (PLAN_Gnn_TURNO_PLANTEL) NUNCA se teclea — se arma
// por partes eligiendo de catálogos reales, con vista previa en vivo y explicación de cada
// pieza. Así no pueden nacer variantes con dedazo como "ELE"/"ELEC" o "TC"/"TEC"/"TC." que
// ya existen en los datos históricos. El servidor (crearGrupo) re-valida todo.
import { useMemo, useState, useTransition } from "react";
import { crearGrupo } from "@/app/actions";

export type DatosNuevoGrupo = {
  planes: { id: number; nombre: string; prefijo: string | null }[];
  turnos: { codigo: string; n: number }[];
  planteles: { plantel: string; campus: string }[];
  claves: string[];
};

const CUATRIS = ["1°", "2°", "3°", "4°", "5°", "6°", "7°", "8°", "9°"];
const input = "w-full px-3 py-2 rounded-md border border-slate-300 text-sm bg-white";
const label = "block text-sm font-medium text-slate-700 mb-1";
const hint = "mt-1 text-xs text-slate-400";

export function NuevoGrupo({
  datos,
  onCreado,
  onCancelar,
}: {
  datos: DatosNuevoGrupo;
  onCreado: (g: { id: number; clave: string }) => void;
  onCancelar: () => void;
}) {
  const [planId, setPlanId] = useState("");
  const [turno, setTurno] = useState("");
  const [plantel, setPlantel] = useState("");
  const [sub, setSub] = useState("");
  const [numero, setNumero] = useState("");        // vacío = usar el sugerido
  const [numeroTocado, setNumeroTocado] = useState(false);
  const [cuatri, setCuatri] = useState("");
  const [alumnos, setAlumnos] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const plan = datos.planes.find((p) => String(p.id) === planId);
  const campus = datos.planteles.find((p) => p.plantel === plantel)?.campus ?? "";

  // Siguiente número libre para la combinación elegida (se sugiere solo; editable).
  const sugerido = useMemo(() => {
    if (!plan?.prefijo || !turno || !campus) return null;
    const sufijo = `_${turno}${sub ? `_${sub}` : ""}_${campus}`;
    const nums = datos.claves
      .filter((c) => c.startsWith(`${plan.prefijo}_G`) && c.endsWith(sufijo))
      .map((c) => Number(c.split("_")[1]?.slice(1)))
      .filter(Number.isFinite);
    return nums.length ? Math.max(...nums) + 1 : 1;
  }, [plan, turno, campus, sub, datos.claves]);

  const numEfectivo = numeroTocado && numero !== "" ? numero : sugerido != null ? String(sugerido) : "";
  const completo = !!(plan?.prefijo && turno && campus && numEfectivo);
  const clavePreview = completo
    ? `${plan!.prefijo}_G${numEfectivo}_${turno}${sub ? `_${sub}` : ""}_${campus}`
    : null;
  const yaExiste = clavePreview != null && datos.claves.includes(clavePreview);

  // Al cambiar cualquier pieza de la combinación, el número vuelve a sugerirse solo.
  const resetNumero = () => { setNumeroTocado(false); setNumero(""); setError(null); };

  const crear = () => {
    if (!plan) { setError("Elige la carrera."); return; }
    if (!turno) { setError("Elige el turno."); return; }
    if (!plantel) { setError("Elige el plantel."); return; }
    const n = Number(numEfectivo);
    if (!Number.isInteger(n) || n < 1) { setError("El número de grupo debe ser un entero positivo."); return; }
    if (yaExiste) { setError(`El grupo ${clavePreview} ya existe. Usa el número sugerido o revisa la lista.`); return; }
    if (!window.confirm(
      `¿Crear el grupo ${clavePreview}?\n\n` +
      `• Carrera: ${plan.nombre}\n• Turno: ${turno}\n• Plantel: ${plantel}` +
      `${sub ? `\n• Subdivisión: ${sub}` : ""}${cuatri ? `\n• Cuatrimestre: ${cuatri}` : ""}` +
      `${alumnos ? `\n• Alumnos: ${alumnos}` : ""}\n\n` +
      `Quedará en el catálogo, disponible para cualquier clase.`,
    )) return;
    setError(null);
    start(async () => {
      const r = await crearGrupo({
        planId: plan.id, numero: n, turnoCodigo: turno, plantel,
        subdivision: sub, cuatrimestre: cuatri, alumnos: alumnos ? Number(alumnos) : null,
      });
      if (!r.ok) { setError(r.error); return; }
      onCreado({ id: r.id, clave: r.clave });
    });
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium text-slate-800">Nuevo grupo — la clave se arma sola</h3>
        <p className="mt-1 text-xs text-slate-500">
          Para evitar errores de dedo, la clave <span className="font-mono">CARRERA_Gnúmero_TURNO_PLANTEL</span>{" "}
          no se escribe a mano: elige cada parte y abajo verás la clave exacta que se va a crear.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={label}>Carrera *</label>
          <select value={planId} onChange={(e) => { setPlanId(e.target.value); resetNumero(); }} className={input}>
            <option value="">Elige la carrera…</option>
            {datos.planes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <p className={hint}>
            {plan?.prefijo
              ? <>Su prefijo en la clave es <span className="font-mono font-medium text-slate-600">{plan.prefijo}</span> (el que ya usan sus {datos.claves.filter((c) => c.startsWith(plan.prefijo + "_")).length} grupos).</>
              : "El prefijo de la clave sale solo de la carrera elegida."}
          </p>
        </div>

        <div>
          <label className={label}>Turno *</label>
          <select value={turno} onChange={(e) => { setTurno(e.target.value); resetNumero(); }} className={input}>
            <option value="">Elige el turno…</option>
            {datos.turnos.map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} — lo usan {t.n} grupos</option>)}
          </select>
          <p className={hint}>Solo códigos que ya existen en los datos (así no nacen variantes nuevas por error).</p>
        </div>

        <div>
          <label className={label}>Plantel *</label>
          <select value={plantel} onChange={(e) => { setPlantel(e.target.value); resetNumero(); }} className={input}>
            <option value="">Elige el plantel…</option>
            {datos.planteles.map((p) => <option key={p.plantel} value={p.plantel}>{p.plantel} → {p.campus}</option>)}
          </select>
          <p className={hint}>El código final ({datos.planteles.map((p) => p.campus).join(", ")}) sale solo del plantel. Usa el mismo plantel que la clase que vas a crear.</p>
        </div>

        <div>
          <label className={label}>Número de grupo *</label>
          <input type="number" min={1} step={1} value={numEfectivo}
            onChange={(e) => { setNumero(e.target.value); setNumeroTocado(true); setError(null); }}
            className={input} placeholder="Se sugiere solo al completar lo demás" />
          <p className={hint}>
            {sugerido != null
              ? <>Te sugerimos <span className="font-mono font-medium text-slate-600">G{sugerido}</span>: es el siguiente número libre para esta combinación. Puedes cambiarlo.</>
              : "Elige carrera, turno y plantel para sugerirte el siguiente número libre."}
          </p>
        </div>

        <div>
          <label className={label}>Subdivisión <span className="text-slate-400 font-normal">(opcional)</span></label>
          <select value={sub} onChange={(e) => { setSub(e.target.value); resetNumero(); }} className={input}>
            <option value="">Sin subdivisión (lo normal)</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
          <p className={hint}>Solo si el grupo se parte en dos secciones (A y B), como IND_G21_SM_A_CB.</p>
        </div>

        <div>
          <label className={label}>Cuatrimestre <span className="text-slate-400 font-normal">(opcional)</span></label>
          <select value={cuatri} onChange={(e) => setCuatri(e.target.value)} className={input}>
            <option value="">— sin capturar —</option>
            {CUATRIS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className={label}>Alumnos <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input type="number" min={0} max={1000} step={1} value={alumnos}
            onChange={(e) => setAlumnos(e.target.value)} className={input}
            placeholder="Se puede capturar después" />
          <p className={hint}>Alimenta la recomendación de aula y la alerta de cupo. Se puede editar después en Compactación.</p>
        </div>
      </div>

      {/* Vista previa en vivo: la clave exacta que se creará, con su explicación. */}
      <div className={`rounded-md border px-3 py-2 ${yaExiste ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-white"}`}>
        {clavePreview ? (
          <>
            <div className="text-sm">
              Se creará el grupo: <span className="font-mono font-semibold text-slate-800">{clavePreview}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {plan!.prefijo} = {plan!.nombre} · G{numEfectivo} = grupo {numEfectivo}
              {sugerido != null && Number(numEfectivo) === sugerido ? " (siguiente libre)" : ""} · {turno} = turno · {sub ? `${sub} = subdivisión · ` : ""}{campus} = {plantel}
            </p>
            {yaExiste && (
              <p className="mt-1 text-xs font-medium text-amber-700">
                ⚠ Ese grupo YA existe en el catálogo{sugerido != null ? ` — el siguiente libre es G${sugerido}` : ""}. Si es el que necesitas, ciérrate de aquí y elígelo de la lista.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-400">Completa carrera, turno y plantel para ver la clave que se creará.</p>
        )}
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={crear} disabled={pending || !completo || yaExiste}
          className="px-4 py-2 rounded-md bg-blue-700 text-white text-sm hover:bg-blue-800 disabled:opacity-50">
          {pending ? "Creando…" : clavePreview ? `Crear ${clavePreview}` : "Crear grupo"}
        </button>
        <button type="button" onClick={onCancelar} disabled={pending}
          className="px-4 py-2 rounded-md border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">
          Cancelar
        </button>
      </div>
    </div>
  );
}
