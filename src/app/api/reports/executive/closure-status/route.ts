// Motor de Cierre Inteligente con Fecha de Corte — endpoint de solo lectura
// para que ReportWizardModal.tsx sepa, ANTES de generar, si el mes
// seleccionado tiene un cierre con corte anticipado/regularizado, y pueda
// avisarlo. Deliberadamente separado de GET /api/tasks/close-month (que
// exige `canManageUsers`, el permiso de administración de cierres, mucho más
// restrictivo que quién puede simplemente GENERAR un reporte) — este
// endpoint solo expone el corte, nada de conteos de tareas.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canAccessReports } from "@/lib/roles";
import { getMonthClosurePeriod } from "@/lib/closurePeriod";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessReports(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Año o mes inválido" }, { status: 400 });
  }

  const { closure } = await getMonthClosurePeriod(year, month);
  return NextResponse.json({
    closed: !!closure,
    cutoffDate: closure ? closure.cutoffDate.toISOString().slice(0, 10) : null,
    closureType: closure?.closureType ?? null,
  });
}
