// Executive Reporting Engine 2.0 (Fase D) — historial paginado de reportes
// ya generados (GENERATED y LEGACY_MIGRATION conviven en la misma lista —
// ver backfill, scripts/backfill-executive-report-snapshots.ts). Mismo
// criterio de visibilidad por `scope` que /api/reports/executive/[reportId].
//
// Cutover de stack (Fase 56, ver docs/AUDIT_LOG.md § 2026-08-25): réplica de
// `ExecutiveReportListView` (backend, Fase 8, completo desde 2026-08-18).
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoReportListItem = {
  report_id: string;
  type: string;
  scope: string;
  origin: string;
  integrity_flag: string;
  period_label: string;
  period_status: string;
  collaborator_count: number;
  generated_by: string;
  generated_at: string;
};

function toNexoShape(r: DjangoReportListItem) {
  return {
    reportId: r.report_id,
    type: r.type,
    scope: r.scope,
    origin: r.origin,
    integrityFlag: r.integrity_flag,
    periodLabel: r.period_label,
    periodStatus: r.period_status,
    collaboratorCount: r.collaborator_count,
    generatedBy: r.generated_by,
    generatedAt: r.generated_at,
  };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const query = request.nextUrl.search;
  const response = await djangoApiFetch(`/reports/executive/list/${query}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener el historial de reportes" }, { status: response.status });
  }

  const data = (await response.json()) as { page: number; page_size: number; total: number; reports: DjangoReportListItem[] };
  return NextResponse.json({
    page: data.page,
    pageSize: data.page_size,
    total: data.total,
    reports: data.reports.map(toNexoShape),
  });
}
