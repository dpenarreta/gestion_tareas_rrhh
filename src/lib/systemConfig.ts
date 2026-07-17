import "server-only";
import { prisma } from "@/lib/prisma";

export const CONFIG_KEY_HORAS_EFECTIVAS = "HORAS_EFECTIVAS_DIA";
export const DEFAULT_HORAS_EFECTIVAS = 6.5;

// Los 4 límites del semáforo de carga laboral son independientes entre sí
// (no derivados de base ± tolerancia) para evitar que un cambio en uno
// desalinee silenciosamente los demás — cada uno se guarda y edita por separado.
export const CONFIG_KEY_WORKLOAD_LIMIT_LOW = "workload_limit_low";
export const DEFAULT_WORKLOAD_LIMIT_LOW = 5.5;

export const CONFIG_KEY_WORKLOAD_LIMIT_HIGH = "workload_limit_high";
export const DEFAULT_WORKLOAD_LIMIT_HIGH = 7.5;

export const CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD = "workload_limit_overload";
export const DEFAULT_WORKLOAD_LIMIT_OVERLOAD = 8.5;

// Política de retención de datos (LOPDP) — meses como string ("6"/"12"/"24"/"36"),
// o "indefinite" para la base de conocimiento cuando no hay fecha límite.
export const CONFIG_KEY_RETENTION_MONTHLY_REPORTS = "retention_monthly_reports";
export const DEFAULT_RETENTION_MONTHLY_REPORTS = "24";

export const CONFIG_KEY_RETENTION_ARCHIVED_TASKS = "retention_archived_tasks";
export const DEFAULT_RETENTION_ARCHIVED_TASKS = "24";

export const CONFIG_KEY_RETENTION_KNOWLEDGE_DOCS = "retention_knowledge_docs";
export const DEFAULT_RETENTION_KNOWLEDGE_DOCS = "indefinite";

// Mensaje de bienvenida configurable por el Admin, mostrado como tarjeta en el Dashboard de todos.
export const CONFIG_KEY_WELCOME_MESSAGE = "welcome_message";
export const CONFIG_KEY_WELCOME_MESSAGE_ACTIVE = "welcome_message_active";

/** Value in effect for `key` at `asOf` (defaults to now). Falls back to `fallback` if no history exists yet. */
export async function getEffectiveConfigValue(
  key: string,
  asOf: Date = new Date(),
  fallback: number = 0
): Promise<number> {
  const record = await prisma.systemConfigHistory.findFirst({
    where: {
      key,
      validFrom: { lte: asOf },
      OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
    },
    orderBy: { validFrom: "desc" },
  });
  if (!record) return fallback;
  const parsed = parseFloat(record.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getEffectiveHorasEfectivas(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_HORAS_EFECTIVAS, asOf, DEFAULT_HORAS_EFECTIVAS);
}

export async function getEffectiveWorkloadLimitLow(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_LOW, asOf, DEFAULT_WORKLOAD_LIMIT_LOW);
}

export async function getEffectiveWorkloadLimitHigh(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_HIGH, asOf, DEFAULT_WORKLOAD_LIMIT_HIGH);
}

export async function getEffectiveWorkloadLimitOverload(asOf: Date = new Date()): Promise<number> {
  return getEffectiveConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD, asOf, DEFAULT_WORKLOAD_LIMIT_OVERLOAD);
}

/** Igual que `getEffectiveConfigValue` pero para valores que no son numéricos (ej. "indefinite"). */
export async function getEffectiveConfigString(
  key: string,
  asOf: Date = new Date(),
  fallback: string
): Promise<string> {
  const record = await prisma.systemConfigHistory.findFirst({
    where: {
      key,
      validFrom: { lte: asOf },
      OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
    },
    orderBy: { validFrom: "desc" },
  });
  return record ? record.value : fallback;
}

export async function getEffectiveRetentionMonthlyReports(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_RETENTION_MONTHLY_REPORTS, asOf, DEFAULT_RETENTION_MONTHLY_REPORTS);
}

export async function getEffectiveRetentionArchivedTasks(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_RETENTION_ARCHIVED_TASKS, asOf, DEFAULT_RETENTION_ARCHIVED_TASKS);
}

export async function getEffectiveRetentionKnowledgeDocs(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_RETENTION_KNOWLEDGE_DOCS, asOf, DEFAULT_RETENTION_KNOWLEDGE_DOCS);
}

export async function getEffectiveWelcomeMessage(asOf: Date = new Date()): Promise<string> {
  return getEffectiveConfigString(CONFIG_KEY_WELCOME_MESSAGE, asOf, "");
}

export async function getEffectiveWelcomeMessageActive(asOf: Date = new Date()): Promise<boolean> {
  return (await getEffectiveConfigString(CONFIG_KEY_WELCOME_MESSAGE_ACTIVE, asOf, "false")) === "true";
}

/** Closes the currently-open history record (if any) and opens a new one, effective now. */
export async function setConfigValue(key: string, value: string, userId: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.systemConfigHistory.updateMany({
      where: { key, validUntil: null },
      data: { validUntil: now },
    }),
    prisma.systemConfigHistory.create({
      data: { key, value, validFrom: now, validUntil: null, updatedBy: userId },
    }),
  ]);
}
