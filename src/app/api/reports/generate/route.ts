import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReports } from "@/lib/roles";
import { resolveReportRoster } from "@/lib/executiveReporting/resolveRoster";
import { buildMonthlySnapshotData } from "@/lib/executiveReporting/buildSnapshotData";
import { renderNovaAsMarkdown } from "@/lib/executiveReporting/nova/renderMarkdown";
import type { Role } from "@/generated/prisma/client";
import type { ReportData } from "@/components/kpis/types";

function parseCsvParam(request: NextRequest, key: string): string[] | undefined {
  const raw = request.nextUrl.searchParams.get(key);
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export async function POST(request: NextRequest) {
  try {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canAccessReports(session.role))
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const monthParam =
    request.nextUrl.searchParams.get("month") ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);

  // Sprint Analytics 2.1 (Bloque 5) — Generador Inteligente: el asistente de
  // configuración puede pedir un subconjunto de colaboradores. Cuando viene
  // `colaboradores`, el informe NO se persiste como MonthlyReport (ese modelo
  // asume siempre el equipo completo, ver unique [month, year, scope]) — se
  // calcula al vuelo y se devuelve sin guardar.
  const colaboradores = parseCsvParam(request, "userIds");
  const roles = parseCsvParam(request, "roles") as Role[] | undefined;
  const areas = parseCsvParam(request, "areas");
  const fechaCorteParam = request.nextUrl.searchParams.get("fechaCorte");
  const fechaCorte = fechaCorteParam && !isNaN(new Date(fechaCorteParam).getTime()) ? new Date(fechaCorteParam) : undefined;
  const persistReport = colaboradores === undefined;

  // Executive Reporting Engine 2.0 (Fase B) — roster + cómputo consolidados
  // en un único builder compartido con /range y /custom-range, alineado al
  // Analytics canónico (ver src/lib/executiveReporting/). Cero cambio de
  // fórmula para el caso sin filtros nuevos: es la MISMA lógica que vivía
  // aquí, reubicada. `fechaCorte`/`roles`/`areas` son nuevos, aditivos —
  // la interfaz para seleccionarlos todavía no existe (llega en una fase
  // posterior), pero el builder ya los soporta de punta a punta.
  const filters = { periodo: { tipoReporte: "MENSUAL" as const, month, year }, fechaCorte, roles, areas, colaboradores };
  const roster = await resolveReportRoster(session, filters);
  const snapshot = await buildMonthlySnapshotData({ roster, filters, generatedBy: { userId: session.userId, name: session.name } });
  const scope = snapshot.meta.scope;

  const reportData: ReportData = {
    month: monthParam,
    scope,
    teamSummary: snapshot.teamSummary,
    members: snapshot.members,
    ranking: snapshot.ranking,
    consultasByReason: snapshot.distribuciones.consultasByReason,
    alerts: snapshot.alerts.map((a) => ({ userId: a.userId, name: a.name, type: a.type, value: a.value })),
    indiceEjecutivo: snapshot.estadoGeneral.indiceEjecutivo,
    trends: snapshot.trends!,
    riskQuadrant: snapshot.distribuciones.riskQuadrant,
    findings: snapshot.findings,
    recommendations: snapshot.recommendations,
    insights: snapshot.insights,
    indicatorExplanations: snapshot.indicatorExplanations,
  };

  // Executive Reporting Engine 2.0 (Fase C) — reemplaza la llamada a Groq
  // independiente/sin caché que vivía aquí (buildAiAnalysis) por la
  // narrativa NOVA ya generada dentro del builder (snapshot.nova, 4
  // secciones estructuradas — ver src/lib/executiveReporting/nova/). Se
  // conserva el mismo criterio de UX que antes: sin GROQ_API_KEY configurada,
  // `aiAnalysis` queda vacío (la UI ya sabe mostrar el aviso de
  // configuración) — con la clave configurada, se renderiza como el mismo
  // bloque markdown de un solo texto que MonthlyReports.tsx ya sabe mostrar,
  // ahora con contenido real (no una plantilla ad hoc aparte).
  const aiAnalysis = process.env.GROQ_API_KEY ? renderNovaAsMarkdown(snapshot.nova!, snapshot.recommendations) : "";

  // Sprint Analytics 2.1 (Bloque 5) — un subconjunto de colaboradores no se
  // persiste (ver nota junto a `requestedUserIds` más arriba): se devuelve
  // igual, con la misma forma que un informe guardado, para que el wizard
  // pueda reutilizar los mismos builders de PDF/Excel del cliente.
  if (!persistReport) {
    return NextResponse.json({
      report: {
        id: `adhoc-${monthParam}-${scope}`,
        month,
        year,
        scope,
        data: reportData,
        aiAnalysis,
        generatedBy: session.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  // Upsert report
  const report = await prisma.monthlyReport.upsert({
    where: { month_year_scope: { month, year, scope } },
    create: {
      month,
      year,
      generatedBy: session.userId,
      scope,
      data: reportData as object,
      aiAnalysis,
    },
    update: {
      generatedBy: session.userId,
      data: reportData as object,
      aiAnalysis,
    },
    include: { generator: { select: { name: true } } },
  });

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
      updatedAt: report.updatedAt.toISOString(),
    },
  });
  } catch (err) {
    console.error("[POST /api/reports/generate]", err);
    return NextResponse.json({ error: "Error al generar el informe" }, { status: 500 });
  }
}
