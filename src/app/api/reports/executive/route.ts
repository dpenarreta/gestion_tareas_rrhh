// Executive Reporting Engine 2.0 (Fase D) — punto de entrada ÚNICO de
// generación hacia adelante: construye el snapshot (Fase B), su narrativa
// NOVA (Fase C, ya incluida por el builder) y lo persiste de forma
// inmutable con Report ID real (Fase A). No reemplaza todavía a
// /api/reports/generate|range|custom-range — esos siguen siendo los que la
// UI actual llama (Fase E hace el repointing); este endpoint es el que
// consumirán las páginas/exportaciones nuevas.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canAccessReports } from "@/lib/roles";
import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/client";
import { resolveReportRoster } from "@/lib/executiveReporting/resolveRoster";
import { buildMonthlySnapshotData, buildRangeSnapshotData, buildCustomRangeSnapshotData } from "@/lib/executiveReporting/buildSnapshotData";
import { createSnapshot, logReportAudit } from "@/lib/executiveReporting/snapshotStore";
import type { ExecutiveReportFilters } from "@/lib/executiveReporting/filters";
import type { ExecutiveReportSnapshotData } from "@/lib/executiveReporting/snapshotData";

function parseCsvParam(request: NextRequest, key: string): string[] | undefined {
  const raw = request.nextUrl.searchParams.get(key);
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function getMonthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

async function buildSnapshotForFilters(
  filters: ExecutiveReportFilters,
  roster: Awaited<ReturnType<typeof resolveReportRoster>>,
  generatedBy: { userId: string; name: string },
): Promise<ExecutiveReportSnapshotData> {
  if (filters.periodo.tipoReporte === "MENSUAL") {
    return buildMonthlySnapshotData({ roster, filters: { ...filters, periodo: filters.periodo }, generatedBy });
  }
  if (filters.periodo.tipoReporte === "RANGO_MESES") {
    return buildRangeSnapshotData({ roster, filters: { ...filters, periodo: filters.periodo }, generatedBy });
  }
  return buildCustomRangeSnapshotData({ roster, filters: { ...filters, periodo: filters.periodo }, generatedBy });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessReports(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const tipoReporte = request.nextUrl.searchParams.get("tipoReporte");
  const colaboradores = parseCsvParam(request, "userIds");
  const roles = parseCsvParam(request, "roles") as Role[] | undefined;
  const areas = parseCsvParam(request, "areas");
  const fechaCorteParam = request.nextUrl.searchParams.get("fechaCorte");
  const fechaCorte = fechaCorteParam && !isNaN(new Date(fechaCorteParam).getTime()) ? new Date(fechaCorteParam) : undefined;

  let filters: ExecutiveReportFilters;
  if (tipoReporte === "MENSUAL") {
    const monthParam = request.nextUrl.searchParams.get("month");
    if (!monthParam) return NextResponse.json({ error: "Parámetro month requerido (YYYY-MM)" }, { status: 400 });
    const [yearStr, monthStr] = monthParam.split("-");
    filters = { periodo: { tipoReporte: "MENSUAL", month: parseInt(monthStr), year: parseInt(yearStr) }, fechaCorte, roles, areas, colaboradores };
  } else if (tipoReporte === "RANGO_MESES") {
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    if (!from || !to) return NextResponse.json({ error: "Parámetros from y to requeridos (YYYY-MM)" }, { status: 400 });
    const months = getMonthsInRange(from, to);
    if (months.length < 2) return NextResponse.json({ error: "El rango debe incluir al menos 2 meses" }, { status: 400 });
    if (months.length > 24) return NextResponse.json({ error: "El rango no puede superar 24 meses" }, { status: 400 });
    filters = { periodo: { tipoReporte: "RANGO_MESES", from, to }, fechaCorte, roles, areas, colaboradores };
  } else if (tipoReporte === "RANGO_PERSONALIZADO") {
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    if (!from || !to) return NextResponse.json({ error: "Parámetros from y to requeridos (YYYY-MM-DD)" }, { status: 400 });
    const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
    if (isNaN(spanDays) || spanDays < 0) return NextResponse.json({ error: "La fecha de inicio debe ser anterior a la fecha de fin" }, { status: 400 });
    if (spanDays > 366) return NextResponse.json({ error: "El rango no puede superar 366 días" }, { status: 400 });
    filters = { periodo: { tipoReporte: "RANGO_PERSONALIZADO", from, to }, fechaCorte, roles, areas, colaboradores };
  } else {
    return NextResponse.json({ error: "tipoReporte inválido — use MENSUAL, RANGO_MESES o RANGO_PERSONALIZADO" }, { status: 400 });
  }

  const generatedBy = { userId: session.userId, name: session.name };

  try {
    const roster = await resolveReportRoster(session, filters);
    const snapshot = await buildSnapshotForFilters(filters, roster, generatedBy);

    const created = await createSnapshot({
      reportId: snapshot.meta.reportId,
      type: snapshot.meta.type,
      scope: snapshot.meta.scope,
      origin: snapshot.meta.origin,
      integrityFlag: snapshot.meta.integrityFlag,
      generatedBy: snapshot.meta.generatedBy.userId,
      generatedAt: new Date(snapshot.meta.generatedAt),
      periodLabel: snapshot.meta.periodLabel,
      periodStart: new Date(snapshot.meta.periodStart),
      periodEnd: new Date(snapshot.meta.periodEnd),
      fechaCorte: new Date(snapshot.meta.fechaCorte),
      periodStatus: snapshot.meta.periodStatus,
      filters: { ...filters, fechaCorte: filters.fechaCorte?.toISOString() } as unknown as Prisma.InputJsonValue,
      collaboratorIds: snapshot.meta.collaboratorIds,
      analyticsEngineVersion: snapshot.meta.versions.analyticsEngineVersion,
      formulaSetVersion: snapshot.meta.versions.formulaSetVersion,
      reportingEngineVersion: snapshot.meta.versions.reportingEngineVersion,
      nexoVersion: snapshot.meta.versions.nexoVersion,
      data: snapshot as unknown as Prisma.InputJsonValue,
      nova: snapshot.nova as unknown as Prisma.InputJsonValue,
      novaDegraded: snapshot.novaDegraded,
      dataQuality: snapshot.estadoGeneral.dataQuality as unknown as Prisma.InputJsonValue,
      generationMs: snapshot.meta.generationMs,
    });

    await logReportAudit({
      reportId: created.reportId,
      action: "generated",
      userId: generatedBy.userId,
      period: snapshot.meta.periodLabel,
      fechaCorte: new Date(snapshot.meta.fechaCorte),
      collaboratorCount: snapshot.meta.collaboratorCount,
      generationMs: snapshot.meta.generationMs,
      analyticsEngineVersion: snapshot.meta.versions.analyticsEngineVersion,
      formulaSetVersion: snapshot.meta.versions.formulaSetVersion,
      nexoVersion: snapshot.meta.versions.nexoVersion,
    });

    return NextResponse.json({ reportId: created.reportId, snapshot });
  } catch (err) {
    // El registro detallado de fallas de generación (Report ID provisional,
    // paso exacto, mensaje técnico) es trabajo de la Fase F
    // (errorLogging.ts) — aquí, como en los 3 endpoints existentes, se
    // registra en consola y se responde un error genérico.
    console.error("[POST /api/reports/executive]", err);
    return NextResponse.json({ error: "Error al generar el informe" }, { status: 500 });
  }
}
