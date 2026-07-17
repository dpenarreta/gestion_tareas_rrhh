import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getNotificationRules, saveNotificationRules, type NotificationRulesConfig } from "@/lib/notificationRules";
import { ALL_ROLES } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

function isRole(value: unknown): value is Role {
  return typeof value === "string" && ALL_ROLES.includes(value as Role);
}

function validateConfig(body: unknown): NotificationRulesConfig | null {
  if (!body || typeof body !== "object") return null;
  const { commentTargets, firstCommentRole, retroactiveNotifyRoles } = body as Record<string, unknown>;

  if (!commentTargets || typeof commentTargets !== "object" || Array.isArray(commentTargets)) return null;
  const cleanTargets: Partial<Record<Role, Role[]>> = {};
  for (const [role, targets] of Object.entries(commentTargets as Record<string, unknown>)) {
    if (!isRole(role) || !Array.isArray(targets)) return null;
    if (!targets.every(isRole)) return null;
    cleanTargets[role] = targets;
  }

  if (firstCommentRole !== null && !isRole(firstCommentRole)) return null;

  if (!Array.isArray(retroactiveNotifyRoles) || !retroactiveNotifyRoles.every(isRole)) return null;

  return { commentTargets: cleanTargets, firstCommentRole, retroactiveNotifyRoles };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const rules = await getNotificationRules();
  return NextResponse.json(rules);
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const config = validateConfig(body);
  if (!config) {
    return NextResponse.json({ error: "Configuración inválida" }, { status: 400 });
  }

  await saveNotificationRules(config, session.userId);
  return NextResponse.json(config);
}
