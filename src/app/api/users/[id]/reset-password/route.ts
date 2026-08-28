import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers, canManageTargetUser } from "@/lib/roles";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoUserToNexoShape } from "@/lib/djangoUsersAdapter";

// Fase 2 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// decisión explícita — skelleton_base nunca deja que un admin defina/vea
// la contraseña nueva de otro usuario. Se reemplaza el reseteo a "123456"
// por forzar el cambio de contraseña en el próximo inicio de sesión y
// revocar las sesiones activas.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const resetResponse = await djangoApiFetch(`/admin/users/${id}/password-reset/`, {
    method: "POST",
    body: JSON.stringify({ force_change_on_next_login: true, revoke_sessions: true }),
  });
  if (!resetResponse) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!resetResponse.ok) {
    return NextResponse.json({ error: "No se pudo restablecer la contraseña" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: `Se forzó el cambio de contraseña de ${user.name}: deberá definir una nueva en su próximo inicio de sesión.`,
  });
}
