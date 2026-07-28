// Persistencia inmutable del Executive Reporting Engine 2.0 (FPS Parte IV
// §2-4, §9). `createSnapshot` es la ÚNICA forma de escribir un
// ExecutiveReportSnapshot — cada llamada crea una fila nueva, nunca actualiza
// una existente (principio de inmutabilidad: un reporte ya emitido no cambia
// jamás). `logReportAudit` es best-effort (mismo criterio que
// `auditCalculation` en analytics.ts) — la auditoría nunca debe romper el
// flujo de generación o lectura de un reporte.
import { Prisma } from "@/generated/prisma/client";
import type {
  ExecutiveReportIntegrity,
  ExecutiveReportOrigin,
  ExecutiveReportPeriodStatus,
  ExecutiveReportSnapshot,
  ExecutiveReportType,
  ReportScope,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateReportId } from "./reportId";

export type CreateSnapshotInput = {
  type: ExecutiveReportType;
  scope: ReportScope;
  generatedBy: string;
  generatedAt?: Date;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  fechaCorte: Date;
  periodStatus: ExecutiveReportPeriodStatus;
  filters: Prisma.InputJsonValue;
  collaboratorIds: string[];
  analyticsEngineVersion: string;
  formulaSetVersion: string;
  reportingEngineVersion: string;
  nexoVersion: string;
  data: Prisma.InputJsonValue;
  nova?: Prisma.InputJsonValue | null;
  novaDegraded?: boolean;
  dataQuality: Prisma.InputJsonValue;
  generationMs: number;
  origin?: ExecutiveReportOrigin;
  integrityFlag?: ExecutiveReportIntegrity;
  legacyMonthlyReportId?: string;
  migratedAt?: Date;
  /**
   * Report ID ya generado por el caller (p. ej. `generateLegacyReportId` en
   * el backfill). Si se pasa, una colisión NO se reintenta con otro id
   * generado aquí — el caller es responsable de desambiguar (el backfill
   * agrega un `seq` incremental).
   */
  reportId?: string;
};

const MAX_REPORT_ID_ATTEMPTS = 5;

function isReportIdUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if ((error as { code?: string }).code !== "P2002") return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) && target.includes("reportId");
}

/**
 * Crea un ExecutiveReportSnapshot inmutable. Si `input.reportId` no viene
 * dado, genera uno nuevo (`generateReportId`) y reintenta con un id distinto
 * hasta `MAX_REPORT_ID_ATTEMPTS` veces ante colisión (P2002 en `reportId`) —
 * la unicidad es un hard guarantee del constraint `@unique` en BD, no solo
 * estadística del generador.
 */
export async function createSnapshot(input: CreateSnapshotInput): Promise<ExecutiveReportSnapshot> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_REPORT_ID_ATTEMPTS; attempt++) {
    const reportId = input.reportId ?? generateReportId(input.generatedAt ?? new Date());
    try {
      return await prisma.executiveReportSnapshot.create({
        data: {
          reportId,
          type: input.type,
          scope: input.scope,
          origin: input.origin ?? "GENERATED",
          integrityFlag: input.integrityFlag ?? "FULL",
          legacyMonthlyReportId: input.legacyMonthlyReportId,
          migratedAt: input.migratedAt,
          generatedBy: input.generatedBy,
          generatedAt: input.generatedAt ?? new Date(),
          periodLabel: input.periodLabel,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          fechaCorte: input.fechaCorte,
          periodStatus: input.periodStatus,
          filters: input.filters,
          collaboratorIds: input.collaboratorIds,
          collaboratorCount: input.collaboratorIds.length,
          analyticsEngineVersion: input.analyticsEngineVersion,
          formulaSetVersion: input.formulaSetVersion,
          reportingEngineVersion: input.reportingEngineVersion,
          nexoVersion: input.nexoVersion,
          data: input.data,
          nova: input.nova ?? Prisma.JsonNull,
          novaDegraded: input.novaDegraded ?? false,
          dataQuality: input.dataQuality,
          generationMs: input.generationMs,
        },
      });
    } catch (error) {
      lastError = error;
      if (input.reportId || !isReportIdUniqueViolation(error)) throw error;
      // Colisión de reportId autogenerado: reintenta con uno nuevo.
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No se pudo generar un Report ID único tras varios intentos.");
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
  userId: string;
  step?: string;
  message?: string;
  period?: string;
  fechaCorte?: Date;
  filtersApplied?: Prisma.InputJsonValue;
  collaboratorCount?: number;
  generationMs?: number;
  analyticsEngineVersion?: string;
  formulaSetVersion?: string;
  nexoVersion?: string;
};

/** Best-effort: nunca lanza — un fallo de auditoría no debe romper la generación/lectura del reporte. */
export async function logReportAudit(entry: ReportAuditEntry): Promise<void> {
  try {
    await prisma.executiveReportAuditLog.create({
      data: {
        reportId: entry.reportId,
        action: entry.action,
        userId: entry.userId,
        step: entry.step,
        message: entry.message,
        period: entry.period,
        fechaCorte: entry.fechaCorte,
        filtersApplied: entry.filtersApplied ?? Prisma.JsonNull,
        collaboratorCount: entry.collaboratorCount,
        generationMs: entry.generationMs,
        analyticsEngineVersion: entry.analyticsEngineVersion,
        formulaSetVersion: entry.formulaSetVersion,
        nexoVersion: entry.nexoVersion,
      },
    });
  } catch {
    // best-effort — ver comentario de módulo.
  }
}
