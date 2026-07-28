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
import type { ExecutiveReportSnapshot, ReportScope } from "@/generated/prisma/client";

function scopeForRole(role: string): ReportScope {
  return role === "JEFE_NACIONAL" || role === "ADMINISTRADOR" ? "JEFE" : "COORDINADOR";
}

/**
 * Los 4 `ExecutiveReportSnapshot` con `origin: LEGACY_MIGRATION` (backfill de
 * Fase D, v1.22.0) se persistieron con `data` SIN el campo `meta` —
 * `scripts/backfill-executive-report-snapshots.ts` (`adaptLegacyReportData`)
 * devolvía deliberadamente `Omit<ExecutiveReportSnapshotData, "meta">` y
 * nunca lo agregó de vuelta antes de insertar; los campos equivalentes
 * quedaron solo como columnas Prisma sueltas (`periodLabel`, `generatedAt`,
 * etc.), nunca anidados dentro del JSON. Esto era invisible porque ningún
 * consumidor anterior leía `data.meta` de un reporte legacy — el repunte de
 * MonthlyReports.tsx es el primer código que lo hace, y ahí revienta
 * (`Cannot read properties of undefined (reading 'periodLabel')` en
 * `documentModel.ts`/`MonthlyReports.tsx`).
 *
 * Se repara en el LÍMITE DE LECTURA — sin volver a escribir en la base
 * compartida ni re-ejecutar el backfill — reconstruyendo `meta` a partir de
 * las columnas propias de la fila, que sí tienen toda la información
 * necesaria (incluido `generator.name` vía el `include` de abajo). Garantiza
 * que todo `report.data` devuelto por este endpoint sea SIEMPRE un
 * `ExecutiveReportSnapshotData` completo, sin que la UI necesite conocer dos
 * formas distintas del contrato.
 */
function ensureSnapshotMeta(row: ExecutiveReportSnapshot & { generator: { name: string } }): unknown {
  const data = row.data as Record<string, unknown> | null;
  if (data && typeof data === "object" && data.meta) return data;

  return {
    ...(data ?? {}),
    meta: {
      reportId: row.reportId,
      origin: row.origin,
      integrityFlag: row.integrityFlag,
      type: row.type,
      // MonthlyReport (el modelo legacy) nunca soportó roster filtrado por
      // rol/colaborador — esa capacidad nace con ExecutiveReportFilters
      // (Fase B) — CONSOLIDADO es el valor correcto para todo reporte
      // LEGACY_MIGRATION, no una suposición.
      rosterKind: "CONSOLIDADO",
      scope: row.scope,
      periodLabel: row.periodLabel,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      fechaCorte: row.fechaCorte.toISOString(),
      periodStatus: row.periodStatus,
      collaboratorIds: row.collaboratorIds,
      collaboratorCount: row.collaboratorCount,
      generatedBy: { userId: row.generatedBy, name: row.generator.name },
      generatedAt: row.generatedAt.toISOString(),
      generationMs: row.generationMs,
      versions: {
        analyticsEngineVersion: row.analyticsEngineVersion,
        formulaSetVersion: row.formulaSetVersion,
        reportingEngineVersion: row.reportingEngineVersion,
        nexoVersion: row.nexoVersion,
      },
    },
  };
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
      data: ensureSnapshotMeta(snapshot),
      nova: snapshot.nova,
      novaDegraded: snapshot.novaDegraded,
      dataQuality: snapshot.dataQuality,
    },
  });
}
