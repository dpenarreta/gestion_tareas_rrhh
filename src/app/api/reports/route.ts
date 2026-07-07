import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReports } from "@/lib/roles";
import type { ReportScope } from "@/generated/prisma/client";

function scopeForRole(role: string): ReportScope {
  return role === "JEFE_NACIONAL" || role === "ADMINISTRADOR" ? "JEFE" : "COORDINADOR";
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessReports(session.role))
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const monthParam = request.nextUrl.searchParams.get("month");

  const scope = scopeForRole(session.role);

  if (monthParam) {
    const [yearStr, monthStr] = monthParam.split("-");
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    const report = await prisma.monthlyReport.findUnique({
      where: { month_year_scope: { month, year, scope } },
      include: { generator: { select: { name: true } } },
    });

    if (!report) return NextResponse.json({ report: null });

    return NextResponse.json({
      report: {
        id: report.id,
        month: report.month,
        year: report.year,
        scope: report.scope,
        data: report.data,
        aiAnalysis: report.aiAnalysis,
        generatedBy: report.generator.name,
        createdAt: report.createdAt.toISOString(),
      },
    });
  }

  // List all reports for this scope
  const reports = await prisma.monthlyReport.findMany({
    where: { scope },
    include: { generator: { select: { name: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return NextResponse.json({
    reports: reports.map((r) => ({
      id: r.id,
      month: r.month,
      year: r.year,
      scope: r.scope,
      generatedBy: r.generator.name,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
