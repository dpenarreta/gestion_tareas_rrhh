import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getSubordinateRoles, canViewOperationalRisk, isExecutorRole } from "@/lib/roles";
import { getNotificationRules } from "@/lib/notificationRules";
import { getEffectiveAnalyticsConfig } from "@/lib/systemConfig";
import { cached, computeOperationalRisk, ANALYTICS_ENGINE_VERSION, type OperationalRiskResult } from "@/lib/analytics";
import type { Role } from "@/generated/prisma/client";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Cuando el riesgo de un colaborador supera "Alto", se notifica automáticamente
 * a su(s) superior(es) directos — mismo criterio configurable que las
 * notificaciones de comentarios de tarea (`getNotificationRules().commentTargets`,
 * Ajustes → Reglas de Notificación; antes de Sprint D usaba la tabla estática
 * `NOTIFICATION_TARGETS`, desincronizándose si un admin reconfiguraba los
 * destinos de comentarios — ver docs/AUDIT_LOG.md § Sprint D). Notifica una
 * sola vez por persona/mes, deduplicado reutilizando `taskId` como marcador
 * sintético (no hay FK real a una tarea aquí) en vez de agregar una columna
 * nueva solo para esto.
 */
async function notifyIfHighRisk(userId: string, userRole: Role, userName: string, risk: OperationalRiskResult, now: Date): Promise<void> {
  if (risk.classification !== "Alto" && risk.classification !== "Crítico") return;
  const marker = `analytics-risk:${userId}:${monthKey(now)}`;
  const already = await prisma.notification.findFirst({ where: { taskId: marker } });
  if (already) return;

  const rules = await getNotificationRules();
  const targetRoles = rules.commentTargets[userRole] ?? [];
  if (targetRoles.length === 0) return;
  const targets = await prisma.user.findMany({ where: { role: { in: targetRoles } }, select: { id: true } });
  if (targets.length === 0) return;

  await prisma.notification.createMany({
    data: targets.map((t) => ({
      userId: t.id,
      message: `Riesgo operativo ${risk.classification.toLowerCase()} (${risk.score}/100) detectado para ${userName}`,
      taskId: marker,
      taskTitle: null,
    })),
  });
}

/** Índice de Riesgo Operativo del equipo — resumen para gerencia, ver Analytics § 13. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canViewOperationalRisk(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  // Roles de liderazgo excluidos: el Riesgo Operativo individual no es
  // representativo para quien dirige, no ejecuta (ver Sprint 0A).
  const subordinateRoles = getSubordinateRoles(session.role).filter(isExecutorRole);
  const subordinates = await prisma.user.findMany({
    where: { role: { in: subordinateRoles } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  if (subordinates.length === 0) {
    return NextResponse.json({ members: [], summary: { bajo: 0, medio: 0, alto: 0, critico: 0 }, engineVersion: ANALYTICS_ENGINE_VERSION, lastUpdated: new Date().toISOString() });
  }

  const config = await getEffectiveAnalyticsConfig();
  const now = new Date();

  const results = await Promise.all(
    subordinates.map(async (s) => {
      const { value, computedAt } = await cached(`risk:${s.id}`, config.cacheTtlMinutes, () => computeOperationalRisk(s.id, now));
      await notifyIfHighRisk(s.id, s.role, s.name, value, now);
      return { id: s.id, name: s.name, role: s.role, ...value, computedAt };
    })
  );

  const members = results
    .map(({ computedAt: _computedAt, ...rest }) => rest)
    .sort((a, b) => b.score - a.score);

  const summary = {
    bajo: members.filter((m) => m.classification === "Bajo").length,
    medio: members.filter((m) => m.classification === "Medio").length,
    alto: members.filter((m) => m.classification === "Alto").length,
    critico: members.filter((m) => m.classification === "Crítico").length,
  };

  const oldestComputedAt = Math.min(...results.map((r) => r.computedAt));

  return NextResponse.json({ members, summary, engineVersion: ANALYTICS_ENGINE_VERSION, lastUpdated: new Date(oldestComputedAt).toISOString() });
}
