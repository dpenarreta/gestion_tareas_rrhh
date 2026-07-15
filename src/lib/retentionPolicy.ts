import "server-only";
import { prisma } from "@/lib/prisma";
import { deleteFromGithub } from "@/lib/githubDocuments";
import { safeLog } from "@/lib/logger";
import {
  getEffectiveRetentionMonthlyReports,
  getEffectiveRetentionArchivedTasks,
  getEffectiveRetentionKnowledgeDocs,
} from "@/lib/systemConfig";

export const MONTHLY_REPORTS_OPTIONS = ["6", "12", "24", "36"] as const;
export const ARCHIVED_TASKS_OPTIONS = ["6", "12", "24", "36"] as const;
export const KNOWLEDGE_DOCS_OPTIONS = ["12", "24", "36", "indefinite"] as const;

function cutoffDate(months: number, asOf: Date): Date {
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

type Policy = {
  monthlyReportsMonths: string;
  archivedTasksMonths: string;
  knowledgeDocsMonths: string;
};

export async function getEffectivePolicy(asOf: Date = new Date()): Promise<Policy> {
  const [monthlyReportsMonths, archivedTasksMonths, knowledgeDocsMonths] = await Promise.all([
    getEffectiveRetentionMonthlyReports(asOf),
    getEffectiveRetentionArchivedTasks(asOf),
    getEffectiveRetentionKnowledgeDocs(asOf),
  ]);
  return { monthlyReportsMonths, archivedTasksMonths, knowledgeDocsMonths };
}

/** IDs de registros que superan la política de retención vigente, sin eliminar nada todavía. */
export async function findPurgeCandidates(asOf: Date = new Date()) {
  const policy = await getEffectivePolicy(asOf);

  const reportsCutoff = cutoffDate(Number(policy.monthlyReportsMonths), asOf);
  const allReports = await prisma.monthlyReport.findMany({ select: { id: true, year: true, month: true } });
  const reportIds = allReports
    .filter((r) => new Date(r.year, r.month - 1, 1) < reportsCutoff)
    .map((r) => r.id);

  const tasksCutoff = cutoffDate(Number(policy.archivedTasksMonths), asOf);
  const archivedTasks = await prisma.task.findMany({
    where: { archivedMonth: { not: null }, archivedAt: { lt: tasksCutoff } },
    select: { id: true },
  });
  const taskIds = archivedTasks.map((t) => t.id);

  let docIds: string[] = [];
  if (policy.knowledgeDocsMonths !== "indefinite") {
    const docsCutoff = cutoffDate(Number(policy.knowledgeDocsMonths), asOf);
    const docs = await prisma.knowledgeDocument.findMany({
      where: { createdAt: { lt: docsCutoff } },
      select: { id: true },
    });
    docIds = docs.map((d) => d.id);
  }

  return { policy, reportIds, taskIds, docIds };
}

/** Elimina los registros que superan la política vigente y deja constancia en el log de auditoría. */
export async function executePurge(executedBy: string): Promise<{
  reportsDeleted: number;
  tasksDeleted: number;
  docsDeleted: number;
}> {
  const { reportIds, taskIds, docIds } = await findPurgeCandidates();

  const docsToDelete = docIds.length
    ? await prisma.knowledgeDocument.findMany({
        where: { id: { in: docIds } },
        select: { id: true, githubPath: true, githubSha: true },
      })
    : [];

  if (reportIds.length > 0) {
    await prisma.monthlyReport.deleteMany({ where: { id: { in: reportIds } } });
  }
  if (taskIds.length > 0) {
    // Comment, TaskActivity, TaskCommentView y FollowUpReminder tienen onDelete: Cascade sobre Task.
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  }
  if (docsToDelete.length > 0) {
    for (const doc of docsToDelete) {
      if (doc.githubPath && doc.githubSha) {
        await deleteFromGithub(doc.githubPath, doc.githubSha).catch((err) =>
          safeLog("error", "[retentionPolicy] no se pudo eliminar el documento de GitHub durante la depuración", err)
        );
      }
    }
    // DocumentChunk tiene onDelete: Cascade sobre KnowledgeDocument.
    await prisma.knowledgeDocument.deleteMany({ where: { id: { in: docsToDelete.map((d) => d.id) } } });
  }

  const result = {
    reportsDeleted: reportIds.length,
    tasksDeleted: taskIds.length,
    docsDeleted: docsToDelete.length,
  };

  await prisma.dataPurgeLog.create({
    data: {
      executedBy,
      reportsDeleted: result.reportsDeleted,
      tasksDeleted: result.tasksDeleted,
      docsDeleted: result.docsDeleted,
    },
  });

  return result;
}
