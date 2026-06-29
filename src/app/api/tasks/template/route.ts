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
      "Fecha Inicio",
      "Fecha Fin",
      "Horas Estimadas",
      "Asignado a (email)",
    ],
    [
      "Ejemplo: Informe mensual",
      "Descripción opcional",
      "ALTA",
      "MENSUAL",
      "01/07/2026",
      "31/07/2026",
      "8",
      "usuario@nexo.com",
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 30 },
    { wch: 30 },
    { wch: 15 },
    { wch: 15 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 30 },
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
