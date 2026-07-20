import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers, ALL_ROLES, ROLE_LABEL } from "@/lib/roles";
import { getAllEffectiveRoleTargets, setRoleTarget, type RoleTarget } from "@/lib/systemConfig";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import type { Role } from "@/generated/prisma/client";

/**
 * Objetivo esperado del cargo (§Sprint 7) — configuración OPCIONAL usada
 * únicamente como referencia en el Benchmark Personal. Mismo grupo de acceso
 * que el resto de configuración de Analytics.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const targets = await getAllEffectiveRoleTargets(ALL_ROLES);
  return NextResponse.json({ targets, roles: ALL_ROLES, roleLabels: ROLE_LABEL });
}

function isValidTarget(body: unknown): body is RoleTarget {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const checkField = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100);
  return checkField(b.performance) && checkField(b.riesgoMax) && checkField(b.cumplimiento);
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { role, target } = (body ?? {}) as { role?: string; target?: unknown };
  if (!role || !ALL_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: `Cargo desconocido: ${role}` }, { status: 400 });
  }
  if (!isValidTarget(target)) {
    return NextResponse.json({ error: "Objetivo inválido: cada campo debe ser un número entre 0 y 100, o null" }, { status: 400 });
  }

  await setRoleTarget(role as Role, target, session.userId);
  invalidateAnalyticsCache();

  const targets = await getAllEffectiveRoleTargets(ALL_ROLES);
  return NextResponse.json({ targets });
}
