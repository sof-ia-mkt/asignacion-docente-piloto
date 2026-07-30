// Fechas de impartición por TIPO de clase, POR CICLO (viven en ciclos.fechas_tipos, jsonb).
// La lógica del calendario CENYCA: el tipo determina el rango dentro del cuatrimestre —
// DISCIPLINAR corre el periodo completo y los MÓDULOS 1/2/3 son bloques secuenciales.
// VIRTUAL no lleva fechas: esas clases no se ofertan a docentes (decisión de coordinación).
// Cada ciclo captura sus propias fechas (el próximo cuatrimestre es un UPDATE, no un deploy).

export type FechasTipos = Record<string, [string, string]>; // tipo -> [inicio, fin] ISO yyyy-mm-dd

// "MODULO 2" / "módulo 2" / "MÓDULO 2" deben encontrar la misma llave: se compara sin acentos.
const clave = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();

// "2026-09-07" -> "07 sep" (mediodía fijo: evita que la zona horaria recorra el día).
// Según el motor ICU, es-MX puede dar "07 sep.", "07-oct" o similar: se normaliza a "07 sep".
const corta = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })
    .replace(/\./g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
};

/** Rango legible ("07 sep – 08 oct") para el tipo de clase, o null si el tipo no tiene fechas. */
export function rangoDeTipo(tipo: string | null, fechas: FechasTipos | null): string | null {
  if (!tipo || !fechas) return null;
  const k = clave(tipo);
  for (const [t, par] of Object.entries(fechas)) {
    if (clave(t) !== k) continue;
    const [i, f] = [corta(par?.[0] ?? ""), corta(par?.[1] ?? "")];
    return i && f ? `${i} – ${f}` : null;
  }
  return null;
}
