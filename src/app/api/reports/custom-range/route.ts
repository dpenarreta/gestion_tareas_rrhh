import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canAccessReports } from "@/lib/roles";
import { resolveReportRoster } from "@/lib/executiveReporting/resolveRoster";
import { buildCustomRangeSnapshotData } from "@/lib/executiveReporting/buildSnapshotData";
import type { PeriodReportData } from "@/components/kpis/types";
import type { Role } from "@/generated/prisma/client";

function parseCsvParam(request: NextRequest, key: string): string[] | undefined {
  const raw = request.nextUrl.searchParams.get(key);
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
}

/**
 * Sprint Analytics 2.1 (Bloques 4-8, Generador Inteligente de Reportes) —
 * único endpoint que cubre los presets de período que NO calzan con límites
 * de mes calendario ("Últimos 30 días", "Rango personalizado"): recibe
 * fechas exactas (`from`/`to`, YYYY-MM-DD) en vez de meses. Los presets que
 * SÍ calzan con meses completos (mes actual/anterior, trimestre, semestre,
 * año) siguen usando /api/reports/generate y /api/reports/range — no se
 * duplica esa lógica aquí (ver docs/AUDIT_LOG.md § Sprint Analytics 2.1).
 * Nunca persiste (no existe un "informe de rango personalizado guardado" —
 * mismo criterio que /api/reports/range).
 *
 * Fechas en UTC-medianoche (no locales) para el cálculo de días hábiles y
 * las consultas — el resto del motor de carga laboral (workload.ts) ya
 * opera así (ver docs/ para el detalle de por qué: servidor en UTC-5, datos
 * guardados en UTC-medianoche). NO es un bug de huso horario: es el mismo
 * criterio que Task.endDate (día calendario puro, sin ambigüedad de huso) —
 * confirmado al construir el builder compartido en Executive Reporting
 * Engine 2.0 Fase B, se conserva sin cambios.
 */

function parseDayUTC(dateStr: string, endOfDay: boolean): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return endOfDay ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)) : new Date(Date.UTC(y, m - 1, d));
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    if (!canAccessReports(session.role))
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

    const fromParam = request.nextUrl.searchParams.get("from");
    const toParam = request.nextUrl.searchParams.get("to");
    if (!fromParam || !toParam)
      return NextResponse.json({ error: "Parámetros from y to requeridos (YYYY-MM-DD)" }, { status: 400 });

    const periodStart = parseDayUTC(fromParam, false);
    const periodEnd = parseDayUTC(toParam, true);
    if (periodStart.getTime() > periodEnd.getTime())
      return NextResponse.json({ error: "La fecha de inicio debe ser anterior a la fecha de fin" }, { status: 400 });
    const spanDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000);
    if (spanDays > 366)
      return NextResponse.json({ error: "El rango no puede superar 366 días" }, { status: 400 });

    const colaboradores = parseCsvParam(request, "userIds");
    const roles = parseCsvParam(request, "roles") as Role[] | undefined;
    const areas = parseCsvParam(request, "areas");
    const fechaCorteParam = request.nextUrl.searchParams.get("fechaCorte");
    const fechaCorte = fechaCorteParam && !isNaN(new Date(fechaCorteParam).getTime()) ? new Date(fechaCorteParam) : undefined;

    // Executive Reporting Engine 2.0 (Fase B) — mismo builder compartido que
    // /generate y /range (ver src/lib/executiveReporting/). Cero cambio de
    // fórmula para el caso sin filtros nuevos: es la misma lógica que vivía
    // aquí, reubicada. `fechaCorte`/`roles`/`areas` son nuevos, aditivos —
    // la interfaz para seleccionarlos llega en una fase posterior.
    const filters = { periodo: { tipoReporte: "RANGO_PERSONALIZADO" as const, from: fromParam, to: toParam }, fechaCorte, roles, areas, colaboradores };
    const roster = await resolveReportRoster(session, filters);
    const snapshot = await buildCustomRangeSnapshotData({ roster, filters, generatedBy: { userId: session.userId, name: session.name } });

    const reportData: PeriodReportData = {
      from: fromParam,
      to: toParam,
      periodLabel: snapshot.meta.periodLabel,
      scope: snapshot.meta.scope,
      teamSummary: snapshot.teamSummary,
      members: snapshot.members,
      ranking: snapshot.ranking,
      consultasByReason: snapshot.distribuciones.consultasByReason,
      alerts: snapshot.alerts.map((a) => ({ userId: a.userId, name: a.name, type: a.type, value: a.value })),
      riskQuadrant: snapshot.distribuciones.riskQuadrant,
      findings: snapshot.findings,
      recommendations: snapshot.recommendations,
      insights: snapshot.insights,
      indicatorExplanations: snapshot.indicatorExplanations,
      aiAnalysis: "",
    };

    return NextResponse.json({ report: reportData });
  } catch (err) {
    console.error("[GET /api/reports/custom-range]", err);
    return NextResponse.json({ error: "Error al generar el informe del período" }, { status: 500 });
  }
}
