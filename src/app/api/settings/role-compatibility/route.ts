import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers, ALL_ROLES, ROLE_LABEL, ROLE_LEVEL } from "@/lib/roles";
import { getAllEffectiveRoleCompatibility, setRoleCompatibility } from "@/lib/systemConfig";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import type { Role } from "@/generated/prisma/client";

/**
 * Matriz de Compatibilidad Operativa — usada únicamente por el motor
 * determinista de recomendaciones (`computeTeamRecommendations`, `analytics.ts`)
 * para decidir con qué otros cargos del MISMO nivel jerárquico puede
 * redistribuirse carga cuando no hay nadie disponible del mismo cargo.
 * Mismo grupo de acceso que el resto de configuración de Analytics.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const matrix = await getAllEffectiveRoleCompatibility(ALL_ROLES);
  return NextResponse.json({ matrix, roles: ALL_ROLES, roleLabels: ROLE_LABEL, roleLevels: ROLE_LEVEL });
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
  // se rechaza aquí ADEMÁS del filtro absoluto en computeTeamRecommendations
  // (defensa en profundidad, no redundancia inútil).
  const invalidLevel = (compatibleRoles as Role[]).find((r) => ROLE_LEVEL[r] !== ROLE_LEVEL[role as Role]);
  if (invalidLevel) {
    return NextResponse.json(
      { error: `"${ROLE_LABEL[invalidLevel]}" no es del mismo nivel jerárquico que "${ROLE_LABEL[role as Role]}" — la redistribución entre niveles distintos nunca está permitida.` },
      { status: 400 }
    );
  }

  const cleaned = (compatibleRoles as Role[]).filter((r) => r !== role);
  await setRoleCompatibility(role as Role, cleaned, session.userId);
  invalidateAnalyticsCache();

  const matrix = await getAllEffectiveRoleCompatibility(ALL_ROLES);
  return NextResponse.json({ matrix });
}
