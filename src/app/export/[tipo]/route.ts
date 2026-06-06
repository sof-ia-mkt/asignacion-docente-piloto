// Descarga de Excel (.xlsx) para cualquier pantalla de datos.
// GET /export/<tipo>?<filtros>  ->  archivo .xlsx con una hoja por tabla del reporte.
// Reutiliza getReport (misma fuente que la vista de impresión), así Excel y PDF
// muestran exactamente lo mismo.

import { getReport } from "@/lib/reports";
import { buildWorkbook, type Sheet } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ tipo: string }> }) {
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
