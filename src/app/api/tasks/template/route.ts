import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const wb = XLSX.utils.book_new();
  const data = [
    [
      "Título",
      "Descripción",
      "Prioridad",
      "Frecuencia",
      "Fecha Inicio (Formato: YYYY-MM-DD)",
      "Fecha Fin (Formato: YYYY-MM-DD)",
      "Tiempo Objetivo",
      "Asignado a (email)",
      "Tipo",
    ],
    [
      "Ejemplo: Informe mensual",
      "Descripción opcional",
      "ALTA",
      "MENSUAL",
      "2026-07-01",
      "2026-07-15",
      "8",
      "usuario@nexo.com",
      "FIJA",
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 30 },
    { wch: 30 },
    { wch: 15 },
    { wch: 15 },
    { wch: 34 },
    { wch: 32 },
    { wch: 18 },
    { wch: 30 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Tareas");

  const raw = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as number[];
  const buffer = new Uint8Array(raw);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla_tareas.xlsx"',
    },
  });
}
