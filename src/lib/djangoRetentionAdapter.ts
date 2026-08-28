import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Política de retención LOPDP + ejecución de la purga — Fase 83 de la
 * migración de stack (ver docs/AUDIT_LOG.md § 2026-08-27). Reemplaza
 * `src/lib/retentionPolicy.ts` (Prisma, eliminado en esta misma fase): lee/
 * escribe `GET/PUT /settings/retention-policy/` (Django, `RetentionPolicyView`,
 * completa desde la Fase 31) y `GET/POST /settings/retention-policy/purge/`
 * (Django, `RetentionPolicyPurgeView`, nueva en esta fase).
 */

export type RetentionPolicy = {
  monthlyReportsMonths: string;
  archivedTasksMonths: string;
  knowledgeDocsMonths: string;
};

type DjangoRetentionPolicy = {
  monthly_reports_months: string;
  archived_tasks_months: string;
  knowledge_docs_months: string;
};

export function toRetentionPolicy(data: DjangoRetentionPolicy): RetentionPolicy {
  return {
    monthlyReportsMonths: data.monthly_reports_months,
    archivedTasksMonths: data.archived_tasks_months,
    knowledgeDocsMonths: data.knowledge_docs_months,
  };
}

export async function fetchRetentionPolicy() {
  return djangoApiFetch("/settings/retention-policy/");
}

export async function updateRetentionPolicy(patch: Partial<RetentionPolicy>) {
  const payload: Record<string, string> = {};
  if (patch.monthlyReportsMonths !== undefined) payload.monthly_reports_months = patch.monthlyReportsMonths;
  if (patch.archivedTasksMonths !== undefined) payload.archived_tasks_months = patch.archivedTasksMonths;
  if (patch.knowledgeDocsMonths !== undefined) payload.knowledge_docs_months = patch.knowledgeDocsMonths;
  return djangoApiFetch("/settings/retention-policy/", { method: "PUT", body: JSON.stringify(payload) });
}

export async function fetchPurgePreview() {
  return djangoApiFetch("/settings/retention-policy/purge/");
}

export async function executeDjangoPurge() {
  return djangoApiFetch("/settings/retention-policy/purge/", { method: "POST" });
}
