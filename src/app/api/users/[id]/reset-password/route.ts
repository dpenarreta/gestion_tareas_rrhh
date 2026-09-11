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

  // `return_link` (2026-09-11): Django devuelve el enlace de recuperación
  // en vez de mandarlo por correo, para entregarlo por el medio que haya a
  // mano. Antes esta ruta solo pedía `force_change_on_next_login`, que
  // obliga a cambiar la contraseña DESPUÉS de iniciar sesión — inútil justo
  // en el caso que importa, alguien que la olvidó y no puede entrar (ver
  // docs/AUDIT_LOG.md § 2026-09-11).
  //
  // `revoke_sessions` cierra las sesiones abiertas de esa cuenta, por si el
  // motivo del restablecimiento es que alguien más tuvo acceso.
  const resetResponse = await djangoApiFetch(`/admin/users/${id}/password-reset/`, {
    method: "POST",
    body: JSON.stringify({
      return_link: true,
      force_change_on_next_login: true,
      revoke_sessions: true,
    }),
  });
  if (!resetResponse) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!resetResponse.ok) {
    return NextResponse.json({ error: "No se pudo restablecer la contraseña" }, { status: 500 });
  }

  const data = (await resetResponse.json().catch(() => null)) as { reset_url?: string } | null;
  if (!data?.reset_url) {
    // Django aceptó la operación pero no devolvió el enlace: las sesiones
    // quedaron cerradas igual, así que no se puede decir que no pasó nada.
    return NextResponse.json(
      {
        error:
          "Se cerraron las sesiones de la cuenta, pero no se pudo generar el enlace de recuperación. Intentá de nuevo.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    resetUrl: data.reset_url,
    userName: user.name,
    message: `Enlace de recuperación generado para ${user.name}.`,
  });
}
