// Helpers sobre `session.permissions` (catálogo dinámico de permisos,
// Django) — ver docs/AUDIT_LOG.md § 2026-09-01 ("Catálogo dinámico de
// permisos extendido a todo el sistema"). Deliberadamente separado de
// `src/lib/roles.ts` (jerarquía de roles fija, hardcodeada) — ninguna
// función existente de `roles.ts` se toca en este cambio; la migración de
// sus ~40+ call sites a permisos queda documentada como trabajo futuro en
// `docs/ROADMAP.md`, módulo por módulo. Server-side siempre revalida vía
// Django (`user_has_permission`) — esto es solo para gating de UI.

export function hasPermission(permissions: string[], codename: string): boolean {
  return permissions.includes(codename);
}

export function hasAnyPermission(permissions: string[], codenames: string[]): boolean {
  return codenames.some((codename) => permissions.includes(codename));
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
