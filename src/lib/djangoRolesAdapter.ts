import "server-only";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Adaptador de "Roles y Permisos" (`GET/POST/PATCH/DELETE /admin/roles/`,
 * `GET /admin/permissions/`) — ver docs/AUDIT_LOG.md § 2026-09-01
 * ("Catálogo dinámico de permisos extendido a todo el sistema"). El backend
 * soporta POST/DELETE (crear/eliminar roles) — este adaptador solo expone
 * GET/PATCH a propósito: `Role` es un union type TS fijo de 11 valores
 * (`src/lib/roles.ts`) que un `Group` creado fuera de esa lista rompería en
 * runtime en todo el resto del frontend (`ROLE_LABEL`/`ROLE_LEVEL`/etc. sin
 * `default`). Ver decisión completa en docs/DECISIONS.md.
 */

export type DjangoRole = { id: number; name: string; permission_codenames: string[] };

export type NexoRoleShape = { id: string; name: string; permissionCodenames: string[] };

export type DjangoPermissionModule = {
  label: string;
  description: string;
  permissions: Record<string, string>;
};

export type DjangoPermissionCatalog = Record<string, DjangoPermissionModule>;

export function mapDjangoRoleToNexoShape(role: DjangoRole): NexoRoleShape {
  return { id: String(role.id), name: role.name, permissionCodenames: role.permission_codenames };
}

/** `GET /admin/roles/` — sin paginar (mismo contrato que ya asume
 * `resolveRoleGroupId` en `djangoUsersAdapter.ts`). */
export async function fetchDjangoRoles(): Promise<DjangoRole[] | null> {
  const response = await djangoApiFetch("/admin/roles/");
  if (!response || !response.ok) return null;
  return response.json();
}

export async function fetchDjangoPermissionCatalog(): Promise<DjangoPermissionCatalog | null> {
  const response = await djangoApiFetch("/admin/permissions/");
  if (!response || !response.ok) return null;
  return response.json();
}

/** Devuelve la `Response` cruda (no pre-parseada) — a diferencia de
 * `fetchDjangoRoles`, el caller necesita distinguir 400 (codename
 * desconocido)/403 de un 401 genérico, para propagar el mensaje real de
 * `RoleWriteSerializer` (ver `.claude/rules/frontend/api.md`). */
export async function patchDjangoRolePermissions(
  id: string,
  permissionCodenames: string[]
): Promise<Response | null> {
  return djangoApiFetch(`/admin/roles/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ permission_codenames: permissionCodenames }),
  });
}
