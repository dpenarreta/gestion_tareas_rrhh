// Executive Reporting Engine 2.0 (Fase D) — lectura INMUTABLE de un reporte
// ya generado. Nunca recalcula: `data` es exactamente el snapshot congelado
// que el builder produjo en su momento (FPS Parte IV §2 — principio de
// inmutabilidad).
//
// Cutover de stack (Fase 56, ver docs/AUDIT_LOG.md § 2026-08-25): réplica de
// `ExecutiveReportDetailView` (backend, Fase 8, completo desde 2026-08-18) —
// `ensureSnapshotMeta`/visibilidad por `scope`/auditoría `viewed` viven ahí
// ahora, no se re-implementan acá.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoReport = {
  report_id: string;
  type: string;
  scope: string;
  origin: string;
  integrity_flag: string;
  period_label: string;
  period_start: string;
  period_end: string;
  fecha_corte: string;
  period_status: string;
  collaborator_count: number;
  generated_by: string;
  generated_at: string;
  generation_ms: number;
  analytics_engine_version: string;
  formula_set_version: string;
  reporting_engine_version: string;
  nexo_version: string;
  data: unknown;
  nova: unknown;
  nova_degraded: boolean;
  data_quality: unknown;
};

function toNexoShape(r: DjangoReport) {
  return {
    reportId: r.report_id,
    type: r.type,
    scope: r.scope,
    origin: r.origin,
    integrityFlag: r.integrity_flag,
    periodLabel: r.period_label,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    fechaCorte: r.fecha_corte,
    periodStatus: r.period_status,
    collaboratorCount: r.collaborator_count,
    generatedBy: r.generated_by,
    generatedAt: r.generated_at,
    generationMs: r.generation_ms,
    analyticsEngineVersion: r.analytics_engine_version,
    formulaSetVersion: r.formula_set_version,
    reportingEngineVersion: r.reporting_engine_version,
    nexoVersion: r.nexo_version,
    data: r.data,
    nova: r.nova,
    novaDegraded: r.nova_degraded,
    dataQuality: r.data_quality,
  };
}

type Ctx = { params: Promise<{ reportId: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { reportId } = await ctx.params;

  const response = await djangoApiFetch(`/reports/executive/${reportId}/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener el reporte" }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json({ report: toNexoShape(data.report as DjangoReport) });
}
