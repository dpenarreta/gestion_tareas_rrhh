// Executive Reporting Engine 2.0 (Fase D) — lectura INMUTABLE de un reporte
// ya generado. Nunca recalcula: `data` es exactamente el snapshot congelado
// que el builder produjo en su momento (FPS Parte IV §2 — principio de
// inmutabilidad). Mismo criterio de visibilidad que /api/reports hoy
// (acceso por `scope`, no una recomprobación de `collaboratorIds` contra el
// visor actual — un snapshot representa la autoridad del generador en su
// momento, no la del visor).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReports } from "@/lib/roles";
import { logReportAudit } from "@/lib/executiveReporting/snapshotStore";
import type { ReportScope } from "@/generated/prisma/client";

function scopeForRole(role: string): ReportScope {
  return role === "JEFE_NACIONAL" || role === "ADMINISTRADOR" ? "JEFE" : "COORDINADOR";
}

type Ctx = { params: Promise<{ reportId: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessReports(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const { reportId } = await ctx.params;
  const snapshot = await prisma.executiveReportSnapshot.findUnique({
    where: { reportId },
    include: { generator: { select: { name: true } } },
  });
  if (!snapshot) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });

  const viewerScope = scopeForRole(session.role);
  if (snapshot.scope !== viewerScope) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  await logReportAudit({ reportId, action: "viewed", userId: session.userId });

  return NextResponse.json({
    report: {
      reportId: snapshot.reportId,
      type: snapshot.type,
      scope: snapshot.scope,
      origin: snapshot.origin,
      integrityFlag: snapshot.integrityFlag,
      periodLabel: snapshot.periodLabel,
      periodStart: snapshot.periodStart.toISOString(),
      periodEnd: snapshot.periodEnd.toISOString(),
      fechaCorte: snapshot.fechaCorte.toISOString(),
      periodStatus: snapshot.periodStatus,
      collaboratorCount: snapshot.collaboratorCount,
      generatedBy: snapshot.generator.name,
      generatedAt: snapshot.generatedAt.toISOString(),
      generationMs: snapshot.generationMs,
      analyticsEngineVersion: snapshot.analyticsEngineVersion,
      formulaSetVersion: snapshot.formulaSetVersion,
      reportingEngineVersion: snapshot.reportingEngineVersion,
      nexoVersion: snapshot.nexoVersion,
      data: snapshot.data,
      nova: snapshot.nova,
      novaDegraded: snapshot.novaDegraded,
      dataQuality: snapshot.dataQuality,
    },
  });
}
