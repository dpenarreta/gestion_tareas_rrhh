import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ALL_ROLES, ROLE_LABEL, ROLE_LEVEL, canManageUsers } from "@/lib/roles";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import type { Role } from "@/lib/roles";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoRoleCompatibilityResponse = { matrix: Record<string, string[]> };

/**
 * Matriz de Compatibilidad Operativa — usada únicamente por el motor
 * determinista de recomendaciones (Django, `analytics/recommendations/team`,
 * Fase 24/47 — el único caller real que le quedaba del lado Next.js,
 * `analytics.ts::computeTeamRecommendations`, es código muerto desde la
 * Fase 47, ver docs/AUDIT_LOG.md § 2026-08-24).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/role-compatibility/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = (await response.json()) as DjangoRoleCompatibilityResponse;
  return NextResponse.json({ matrix: data.matrix, roles: ALL_ROLES, roleLabels: ROLE_LABEL, roleLevels: ROLE_LEVEL });
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
  const { role, compatibleRoles } = (body ?? {}) as { role?: string; compatibleRoles?: unknown };
  if (!role || !ALL_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: `Cargo desconocido: ${role}` }, { status: 400 });
  }
  if (!Array.isArray(compatibleRoles) || !compatibleRoles.every((r) => typeof r === "string" && ALL_ROLES.includes(r as Role))) {
    return NextResponse.json({ error: "compatibleRoles debe ser una lista de cargos válidos" }, { status: 400 });
  }

  // Regla 4 (dura): nunca configurable entre niveles jerárquicos distintos —
  // se rechaza aquí ADEMÁS del filtro absoluto en Django
  // (compute_team_recommendations), defensa en profundidad.
  const invalidLevel = (compatibleRoles as Role[]).find((r) => ROLE_LEVEL[r] !== ROLE_LEVEL[role as Role]);
  if (invalidLevel) {
    return NextResponse.json(
      { error: `"${ROLE_LABEL[invalidLevel]}" no es del mismo nivel jerárquico que "${ROLE_LABEL[role as Role]}" — la redistribución entre niveles distintos nunca está permitida.` },
      { status: 400 }
    );
  }

  const cleaned = (compatibleRoles as Role[]).filter((r) => r !== role);

  const response = await djangoApiFetch("/settings/role-compatibility/", {
    method: "PATCH",
    body: JSON.stringify({ role, compatible_roles: cleaned }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = (await response.json()) as DjangoRoleCompatibilityResponse;
  return NextResponse.json({ matrix: data.matrix });
}
