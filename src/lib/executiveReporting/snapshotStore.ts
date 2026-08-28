// Persistencia inmutable del Executive Reporting Engine 2.0 (FPS Parte IV
// §2-4, §9). `createSnapshot` es la ÚNICA forma de escribir un
// ExecutiveReportSnapshot — cada llamada crea una fila nueva, nunca actualiza
// una existente (principio de inmutabilidad: un reporte ya emitido no cambia
// jamás). `logReportAudit` es best-effort (mismo criterio que
// `auditCalculation` en analytics.ts) — la auditoría nunca debe romper el
// flujo de generación o lectura de un reporte.
//
// Cutover de stack (Fase 56, ver docs/AUDIT_LOG.md § 2026-08-25): el CÁLCULO
// del snapshot (`buildSnapshotData.ts`, ~1183 líneas) sigue sin cambios en
// Next.js/Prisma — solo la PERSISTENCIA pasa a Django
// (`ExecutiveReportCreateView`/`ExecutiveReportAuditCreateView`), para que
// los reportes generados queden visibles en los mismos endpoints de lectura
// de la Fase 8. `generatedBy`/`userId` ya NO se pasan como input — Django
// resuelve el actor desde el JWT (`request.user`), nunca desde el body.
import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";
import { generateReportId } from "./reportId";

export type CreateSnapshotInput = {
  type: string;
  scope: string;
  generatedAt?: Date;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  fechaCorte: Date;
  periodStatus: string;
  filters: unknown;
  collaboratorIds: string[];
  analyticsEngineVersion: string;
  formulaSetVersion: string;
  reportingEngineVersion: string;
  nexoVersion: string;
  data: unknown;
  nova?: unknown | null;
  novaDegraded?: boolean;
  dataQuality: unknown;
  generationMs: number;
  origin?: string;
  integrityFlag?: string;
  /**
   * Report ID ya generado por el caller. Si se pasa, una colisión NO se
   * reintenta con otro id generado acá — el caller es responsable de
   * desambiguar.
   */
  reportId?: string;
};

const MAX_REPORT_ID_ATTEMPTS = 5;

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

/**
 * Crea un ExecutiveReportSnapshot inmutable en Django. Si `input.reportId` no
 * viene dado, genera uno nuevo (`generateReportId`) y reintenta con un id
 * distinto hasta `MAX_REPORT_ID_ATTEMPTS` veces ante colisión (409 del
 * `unique=True` en `report_id`) — la unicidad es un hard guarantee del
 * constraint de BD, no solo estadística del generador.
 */
export async function createSnapshot(input: CreateSnapshotInput): Promise<{ reportId: string }> {
  for (let attempt = 0; attempt < MAX_REPORT_ID_ATTEMPTS; attempt++) {
    const reportId = input.reportId ?? generateReportId(input.generatedAt ?? new Date());
    const response = await djangoApiFetch("/reports/executive/", {
      method: "POST",
      body: JSON.stringify({
        report_id: reportId,
        type: input.type,
        scope: input.scope,
        origin: input.origin ?? "GENERATED",
        integrity_flag: input.integrityFlag ?? "FULL",
        generated_at: (input.generatedAt ?? new Date()).toISOString(),
        period_label: input.periodLabel,
        period_start: input.periodStart.toISOString(),
        period_end: input.periodEnd.toISOString(),
        fecha_corte: input.fechaCorte.toISOString(),
        period_status: input.periodStatus,
        filters: input.filters,
        collaborator_ids: input.collaboratorIds,
        analytics_engine_version: input.analyticsEngineVersion,
        formula_set_version: input.formulaSetVersion,
        reporting_engine_version: input.reportingEngineVersion,
        nexo_version: input.nexoVersion,
        data: input.data,
        nova: input.nova ?? null,
        nova_degraded: input.novaDegraded ?? false,
        data_quality: input.dataQuality,
        generation_ms: input.generationMs,
      }),
    });
    if (!response) {
      throw new Error(DJANGO_SESSION_REQUIRED_MESSAGE);
    }
    if (response.status === 409) {
      if (input.reportId) throw new Error(`El Report ID "${input.reportId}" ya existe.`);
      continue; // Colisión de reportId autogenerado: reintenta con uno nuevo.
    }
    if (!response.ok) {
      throw new Error("No se pudo persistir el reporte generado.");
    }
    const data = (await response.json()) as { report_id: string };
    return { reportId: data.report_id };
  }
  throw new Error("No se pudo generar un Report ID único tras varios intentos.");
}

export type ReportAuditAction =
  | "generated"
  | "generation_failed"
  | "nova_degraded"
  | "viewed"
  | "exported_pdf"
  | "exported_excel"
  | "legacy_migrated";

export type ReportAuditEntry = {
  reportId: string;
  action: ReportAuditAction;
  step?: string;
  message?: string;
  period?: string;
  fechaCorte?: Date;
  filtersApplied?: unknown;
  collaboratorCount?: number;
  generationMs?: number;
  analyticsEngineVersion?: string;
  formulaSetVersion?: string;
  nexoVersion?: string;
};

/** Best-effort: nunca lanza — un fallo de auditoría no debe romper la generación/lectura del reporte. */
export async function logReportAudit(entry: ReportAuditEntry): Promise<void> {
  try {
    await djangoApiFetch("/reports/executive/audit/", {
      method: "POST",
      body: JSON.stringify({
        report_id: entry.reportId,
        action: entry.action,
        step: entry.step,
        message: entry.message,
        period: entry.period,
        fecha_corte: entry.fechaCorte?.toISOString(),
        filters_applied: entry.filtersApplied,
        collaborator_count: entry.collaboratorCount,
        generation_ms: entry.generationMs,
        analytics_engine_version: entry.analyticsEngineVersion,
        formula_set_version: entry.formulaSetVersion,
        nexo_version: entry.nexoVersion,
      }),
    });
  } catch {
    // best-effort — ver comentario de módulo.
  }
}
