// Descarga de Excel (.xlsx) para cualquier pantalla de datos.
// GET /export/<tipo>?<filtros>  ->  archivo .xlsx con una hoja por tabla del reporte.
// Reutiliza getReport (misma fuente que la vista de impresión), así Excel y PDF
// muestran exactamente lo mismo.

import { getReport } from "@/lib/reports";
import { buildWorkbook, type Sheet } from "@/lib/xlsx";
import { sesionActual } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ tipo: string }> }) {
  // Candado propio (defensa en profundidad): los route handlers no pasan por el layout,
  // así que si el matcher del middleware cambiara, este endpoint filtraría toda la data.
  // Además valida contra la base que el usuario siga ACTIVO, no solo la firma del token.
  if (!(await sesionActual())) {
    return new Response("No autorizado", { status: 401 });
  }
  const { tipo } = await ctx.params;
  const params = new URL(request.url).searchParams;

  const report = await getReport(tipo, params);
  if (!report) {
    return new Response("Reporte no encontrado", { status: 404 });
  }

  const sheets: Sheet[] = report.tables.map((t) => ({
    name: t.name,
    headers: t.headers,
    rows: t.rows,
  }));
  const buffer = buildWorkbook(sheets);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${report.filename}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
