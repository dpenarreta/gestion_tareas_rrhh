import "server-only";
import { prisma } from "@/lib/prisma";
import { NOTIFICATION_TARGETS } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

export const NOTIFICATION_RULES_CONFIG_KEY = "notification_rules";

export type NotificationRulesConfig = {
  /** Por rol que comenta una TAREA -> rol(es) que reciben la notificación. */
  commentTargets: Partial<Record<Role, Role[]>>;
  /** Rol notificado además cuando es el PRIMER comentario registrado en una tarea (null = desactivado). */
  firstCommentRole: Role | null;
  /** Roles notificados cuando alguien registra horas retroactivas. */
  retroactiveNotifyRoles: Role[];
};

function defaultRules(): NotificationRulesConfig {
  return {
    // Mismo comportamiento que tenía antes de ser configurable (upward en la jerarquía).
    commentTargets: { ...NOTIFICATION_TARGETS },
    firstCommentRole: null,
    retroactiveNotifyRoles: ["COORDINADOR_NACIONAL"],
  };
}

export async function getNotificationRules(): Promise<NotificationRulesConfig> {
  const record = await prisma.systemConfigHistory.findFirst({
    where: { key: NOTIFICATION_RULES_CONFIG_KEY, validUntil: null },
    orderBy: { validFrom: "desc" },
  });
  if (!record) return defaultRules();
  try {
    const parsed = JSON.parse(record.value) as Partial<NotificationRulesConfig>;
    return {
      commentTargets: parsed.commentTargets ?? {},
      firstCommentRole: parsed.firstCommentRole ?? null,
      retroactiveNotifyRoles: parsed.retroactiveNotifyRoles ?? [],
    };
  } catch {
    return defaultRules();
  }
}

export async function saveNotificationRules(config: NotificationRulesConfig, userId: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.systemConfigHistory.updateMany({
      where: { key: NOTIFICATION_RULES_CONFIG_KEY, validUntil: null },
      data: { validUntil: now },
    }),
    prisma.systemConfigHistory.create({
      data: {
        key: NOTIFICATION_RULES_CONFIG_KEY,
        value: JSON.stringify(config),
        validFrom: now,
        validUntil: null,
        updatedBy: userId,
      },
    }),
  ]);
}
