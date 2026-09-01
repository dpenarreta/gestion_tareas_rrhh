import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { extractDjangoFieldErrorMessage } from "@/lib/djangoSession";
import { canManageRoles } from "@/lib/permissions";
import { patchDjangoRolePermissions, mapDjangoRoleToNexoShape, type DjangoRole } from "@/lib/djangoRolesAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

// `PATCH /api/v1/admin/roles/[id]/` — reemplazo COMPLETO del set de
// permisos de un rol (igual que `RoleService.update_role` en Django, ver
// docs/AUDIT_LOG.md § 2026-09-01). Solo `permission_codenames` — el nombre
// del rol no es editable desde esta pantalla (los 11 roles de Nexo son
// fijos, ver docs/DECISIONS.md).
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  // Defensa en profundidad — Django ya exige `roles.editar`
  // (`RolesPermission`), mismo criterio que `role-compatibility/route.ts`.
  if (!canManageRoles(session.permissions)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { permissionCodenames } = (body ?? {}) as { permissionCodenames?: unknown };
  if (!Array.isArray(permissionCodenames) || !permissionCodenames.every((c) => typeof c === "string")) {
    return NextResponse.json({ error: "permissionCodenames debe ser una lista de strings" }, { status: 400 });
  }

  const response = await patchDjangoRolePermissions(id, permissionCodenames);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFieldErrorMessage(response);
    return NextResponse.json({ error: message ?? "No se pudo guardar" }, { status: response.status === 403 ? 403 : 400 });
  }

  const role: DjangoRole = await response.json();
  return NextResponse.json(mapDjangoRoleToNexoShape(role));
}
