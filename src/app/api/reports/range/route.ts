import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canAccessReports } from "@/lib/roles";
import { resolveReportRoster } from "@/lib/executiveReporting/resolveRoster";
import { buildRangeSnapshotData } from "@/lib/executiveReporting/buildSnapshotData";
import { renderNovaAsMarkdown } from "@/lib/executiveReporting/nova/renderMarkdown";
import type { Role } from "@/generated/prisma/client";
import type { RangeReportData } from "@/components/kpis/types";

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
    if (++m > 12) { m = 1; y++; }
  }
  return months;
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
      return NextResponse.json({ error: "Parámetros from y to requeridos" }, { status: 400 });

    const months = getMonthsInRange(fromParam, toParam);
    if (months.length < 2)
      return NextResponse.json({ error: "El rango debe incluir al menos 2 meses" }, { status: 400 });
    if (months.length > 24)
      return NextResponse.json({ error: "El rango no puede superar 24 meses" }, { status: 400 });

    // Sprint Analytics 2.1 (Bloque 5) — Generador Inteligente: subconjunto
    // opcional de colaboradores pedido por el asistente de configuración.
    const colaboradores = parseCsvParam(request, "userIds");
    const roles = parseCsvParam(request, "roles") as Role[] | undefined;
    const areas = parseCsvParam(request, "areas");
    const fechaCorteParam = request.nextUrl.searchParams.get("fechaCorte");
    const fechaCorte = fechaCorteParam && !isNaN(new Date(fechaCorteParam).getTime()) ? new Date(fechaCorteParam) : undefined;

    // Executive Reporting Engine 2.0 (Fase B) — mismo builder compartido que
    // /generate y /custom-range (ver src/lib/executiveReporting/). Cero
    // cambio de fórmula para el caso sin filtros nuevos: es la misma lógica
    // que vivía aquí, reubicada. `fechaCorte`/`roles`/`areas` son nuevos,
    // aditivos — la interfaz para seleccionarlos llega en una fase posterior.
    const filters = { periodo: { tipoReporte: "RANGO_MESES" as const, from: fromParam, to: toParam }, fechaCorte, roles, areas, colaboradores };
    const roster = await resolveReportRoster(session, filters);
    const snapshot = await buildRangeSnapshotData({ roster, filters, generatedBy: { userId: session.userId, name: session.name } });

    // Executive Reporting Engine 2.0 (Fase C) — reemplaza buildRangeAiAnalysis
    // (llamada a Groq independiente/sin caché) por la narrativa NOVA ya
    // generada dentro del builder — ver nota equivalente en /generate.
    const aiAnalysis = process.env.GROQ_API_KEY ? renderNovaAsMarkdown(snapshot.nova!, snapshot.recommendations) : "";

    const reportData: RangeReportData = {
      from: fromParam,
      to: toParam,
      scope: snapshot.meta.scope,
      months: snapshot.monthlyEvolution!,
      aggregated: {
        teamSummary: snapshot.teamSummary,
        members: snapshot.members,
        ranking: snapshot.ranking.map((r) => ({ id: r.id, name: r.name, role: r.role, avgScore: r.score, avgCumplimiento: r.completedPct })),
        consultasByReason: snapshot.distribuciones.consultasByReason,
        alerts: snapshot.alerts.map((a) => ({ userId: a.userId, name: a.name, type: a.type, avgValue: a.value, monthsAffected: a.monthsAffected! })),
        problematicMonths: snapshot.problematicMonths!,
        riskQuadrant: snapshot.distribuciones.riskQuadrant,
        findings: snapshot.findings,
        recommendations: snapshot.recommendations,
        insights: snapshot.insights,
      },
      trends: snapshot.rangeTrend!,
      aiAnalysis,
    };

    return NextResponse.json({ report: reportData });
  } catch (err) {
    console.error("[GET /api/reports/range]", err);
    return NextResponse.json({ error: "Error al generar el informe de rango" }, { status: 500 });
  }
}
