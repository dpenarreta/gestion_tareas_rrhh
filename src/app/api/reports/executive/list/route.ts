// Executive Reporting Engine 2.0 (Fase D) — historial paginado de reportes
// ya generados (GENERATED y LEGACY_MIGRATION conviven en la misma lista —
// ver backfill, scripts/backfill-executive-report-snapshots.ts). Mismo
// criterio de visibilidad por `scope` que /api/reports y
// /api/reports/executive/[reportId].
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReports } from "@/lib/roles";
import type { ReportScope } from "@/generated/prisma/client";

function scopeForRole(role: string): ReportScope {
  return role === "JEFE_NACIONAL" || role === "ADMINISTRADOR" ? "JEFE" : "COORDINADOR";
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessReports(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const scope = scopeForRole(session.role);
  const pageParam = parseInt(request.nextUrl.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const pageSizeParam = parseInt(request.nextUrl.searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? Math.min(pageSizeParam, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  const [total, rows] = await Promise.all([
    prisma.executiveReportSnapshot.count({ where: { scope } }),
    prisma.executiveReportSnapshot.findMany({
      where: { scope },
      include: { generator: { select: { name: true } } },
      orderBy: [{ generatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    page,
    pageSize,
    total,
    reports: rows.map((r) => ({
      reportId: r.reportId,
      type: r.type,
      scope: r.scope,
      origin: r.origin,
      integrityFlag: r.integrityFlag,
      periodLabel: r.periodLabel,
      periodStatus: r.periodStatus,
      collaboratorCount: r.collaboratorCount,
      generatedBy: r.generator.name,
      generatedAt: r.generatedAt.toISOString(),
    })),
  });
}
