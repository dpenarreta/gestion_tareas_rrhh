import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers, canManageTargetUser } from "@/lib/roles";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";
import { mapDjangoUserToNexoShape, type NexoUserShape } from "@/lib/djangoUsersAdapter";
import type { SessionPayload } from "@/lib/session";

/**
 * Guards compartidos por las acciones administrativas sobre UN usuario
 * (dar de baja, eliminar). Se extrajeron al separar esas dos operaciones en
 * rutas distintas (ver docs/AUDIT_LOG.md § 2026-09-11): son la misma
 * secuencia de comprobaciones y no tiene sentido mantenerla por duplicado.
 *
 * Son guards de UI/UX, no la autorización real: Django revalida todo con
 * `permission_classes` (ver .claude/rules/security.md).
 */

export const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type AccessResult =
  | { ok: true; session: SessionPayload; target: NexoUserShape }
  | { ok: false; response: NextResponse };

/**
 * Resuelve sesión, permisos y existencia del usuario objetivo. Devuelve la
 * respuesta de error ya armada cuando algo no pasa, para que la ruta solo
 * tenga que devolverla.
 *
 * `Usuario no encontrado` (404) se usa tanto para el que no existe como para
 * el que la jerarquía no deja tocar: no se le confirma a quien pregunta que
 * esa cuenta existe si no puede administrarla.
 */
export async function resolveUserAdminAccess(
  id: string,
  options: { selfActionError?: string } = {}
): Promise<AccessResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }
  if (!canManageUsers(session.role)) {
    return { ok: false, response: NextResponse.json({ error: "Sin permisos" }, { status: 403 }) };
  }

  // El guard de "sobre uno mismo" va ANTES de consultar a Django: no hace
  // falta traer un usuario para saber que es el propio. `djangoUserId` puede
  // no resolverse (JWT viejo); en ese caso no bloquea acá y Django, que sí
  // conoce al autenticado, aplica su propia versión de la regla.
  if (options.selfActionError) {
    const djangoUserId = await resolveDjangoUserId(session);
    if (djangoUserId !== null && id === String(djangoUserId)) {
      return {
        ok: false,
        response: NextResponse.json({ error: options.selfActionError }, { status: 400 }),
      };
    }
  }

  const response = await djangoApiFetch(`/admin/users/${id}/`);
  if (!response) {
    return {
      ok: false,
      response: NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 }),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 }),
    };
  }

  const target = mapDjangoUserToNexoShape(await response.json());
  if (!canManageTargetUser(session, target.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 }),
    };
  }

  return { ok: true, session, target };
}
