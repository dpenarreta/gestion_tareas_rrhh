import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";
import { NOTIFICATION_TARGETS } from "@/lib/roles";
import type { Role } from "@/lib/roles";

/**
 * Fase 86 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-28).
 * Réplica de `notificationRules.ts` contra `NotificationRulesView`
 * (Django, completa desde la Fase 35). GAP DOCUMENTADO heredado sin
 * cambios: `apps/tasks/services.py` sigue sin leer esta configuración
 * (ver `apps.configuration.services.CONFIG_KEY_NOTIFICATION_RULES`) —
 * esta fase solo mueve el almacenamiento/lectura, no conecta los
 * consumidores reales, igual que ya ocurría en la versión Prisma.
 */

export type NotificationRulesConfig = {
  commentTargets: Partial<Record<Role, Role[]>>;
  firstCommentRole: Role | null;
  retroactiveNotifyRoles: Role[];
};

type DjangoNotificationRules = {
  comment_targets: Partial<Record<Role, Role[]>>;
  first_comment_role: Role | null;
  retroactive_notify_roles: Role[];
};

const FALLBACK_RULES: NotificationRulesConfig = {
  commentTargets: { ...NOTIFICATION_TARGETS },
  firstCommentRole: null,
  retroactiveNotifyRoles: ["COORDINADOR_NACIONAL"],
};

function toNexoShape(data: DjangoNotificationRules): NotificationRulesConfig {
  return {
    commentTargets: data.comment_targets,
    firstCommentRole: data.first_comment_role,
    retroactiveNotifyRoles: data.retroactive_notify_roles,
  };
}

export async function fetchNotificationRules(): Promise<NotificationRulesConfig> {
  const response = await djangoApiFetch("/settings/notification-rules/");
  if (!response || !response.ok) return FALLBACK_RULES;
  return toNexoShape((await response.json()) as DjangoNotificationRules);
}

/** `response` es la del PUT — el llamador debe chequear `response.ok` antes de usar el body. */
export async function putNotificationRules(config: NotificationRulesConfig) {
  return djangoApiFetch("/settings/notification-rules/", {
    method: "PUT",
    body: JSON.stringify({
      comment_targets: config.commentTargets,
      first_comment_role: config.firstCommentRole,
      retroactive_notify_roles: config.retroactiveNotifyRoles,
    }),
  });
}
