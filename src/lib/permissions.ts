// Helpers sobre `session.permissions` (catálogo dinámico de permisos,
// Django) — ver docs/AUDIT_LOG.md § 2026-09-01 ("Catálogo dinámico de
// permisos extendido a todo el sistema"). Deliberadamente separado de
// `src/lib/roles.ts` (jerarquía de roles fija, hardcodeada) — ninguna
// función existente de `roles.ts` se toca en este cambio; la migración de
// sus ~40+ call sites a permisos queda documentada como trabajo futuro en
// `docs/ROADMAP.md`, módulo por módulo. Server-side siempre revalida vía
// Django (`user_has_permission`) — esto es solo para gating de UI.

import type { Role } from "@/lib/roles";

// Sentinel para "tiene todos los permisos" — ver `sessionPermissionsFor`.
const ALL_PERMISSIONS = "*";

export function hasPermission(permissions: string[], codename: string): boolean {
  return permissions.includes(ALL_PERMISSIONS) || permissions.includes(codename);
}

export function hasAnyPermission(permissions: string[], codenames: string[]): boolean {
  if (permissions.includes(ALL_PERMISSIONS)) return true;
  return codenames.some((codename) => permissions.includes(codename));
}

/** Reduce los codenames de Django al valor que se guarda en el JWT de
 * sesión. `ADMINISTRADOR` es superusuario (bypass total, ver
 * `backend/apps/permissions/authorization.py::user_has_permission`) — su
 * `get_all_permissions()` devuelve el catálogo COMPLETO de Django (~250
 * codenames, todo modelo × toda acción, no solo los ~30 del catálogo de
 * negocio), que no entra en una cookie de sesión sin superar el límite
 * práctico de ~4KB por cookie que los navegadores aplican — el
 * `Set-Cookie` se emite pero el navegador lo descarta en silencio, y el
 * login queda roto para cualquier cuenta ADMINISTRADOR (ver
 * docs/AUDIT_LOG.md § 2026-09-02). Se reemplaza por un sentinel. */
export function sessionPermissionsFor(role: Role | string, permissions: string[]): string[] {
  return role === "ADMINISTRADOR" ? [ALL_PERMISSIONS] : permissions;
}

/** Gestión y asignación de permisos por rol (`/admin/roles`) — única
 * pantalla de este cambio que guarda por permiso desde el día uno, ya que
 * es la propia pantalla que administra el catálogo. */
export function canManageRoles(permissions: string[]): boolean {
  return hasPermission(permissions, "roles.editar");
}

export function canViewRoles(permissions: string[]): boolean {
  return hasPermission(permissions, "roles.ver");
}
