import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers, canManageTargetUser } from "@/lib/roles";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoUserToNexoShape } from "@/lib/djangoUsersAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25): réplica de la
// acción `reset_consent` de `UserAdminViewSet` (backend, Fase 13,
// completo) — mismo patrón que `reset-password/route.ts` (Fase 2):
// se conserva `canManageUsers`/`canManageTargetUser` en TS además del
// catálogo de permisos que ya aplica Django.
export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const userResponse = await djangoApiFetch(`/admin/users/${id}/`);
  if (!userResponse) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!userResponse.ok) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  const user = mapDjangoUserToNexoShape(await userResponse.json());
  if (!canManageTargetUser(session, user.role)) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const resetResponse = await djangoApiFetch(`/admin/users/${id}/reset-consent/`, { method: "POST" });
  if (!resetResponse) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!resetResponse.ok) {
    return NextResponse.json({ error: "No se pudo restablecer el consentimiento" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
