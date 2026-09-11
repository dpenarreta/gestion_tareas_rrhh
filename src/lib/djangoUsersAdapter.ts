import "server-only";
import type { Role } from "@/lib/roles";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Adaptador entre la forma de usuario de Django (Fase 2 de la migración de
 * stack, ver docs/AUDIT_LOG.md § 2026-08-07) y la forma que ya espera el
 * frontend de Nexo (`UsersManager.tsx`, sin cambios). Vive en su propio
 * módulo porque lo consumen tanto `/api/users` como `/api/users/[id]`.
 */

export type DjangoUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  status: "active" | "disabled" | "blocked";
  is_superuser: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  roles: { id: number; name: string }[];
  data_consent_accepted: boolean;
  data_consent_accepted_at: string | null;
};

export type NexoUserShape = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: DjangoUser["status"];
  createdAt: string;
  dataConsentAccepted: boolean;
  dataConsentAcceptedAt: string | null;
};

export function mapDjangoUserToNexoShape(user: DjangoUser): NexoUserShape {
  return {
    id: String(user.id),
    name: user.first_name || user.username,
    email: user.email,
    // Invariante de 1 rol por usuario (ver apps/hierarchy/services.py del
    // backend) — el primer grupo asignado es "el rol" de Nexo.
    role: (user.roles[0]?.name ?? "") as Role,
    // Nexo no elimina usuarios, los deshabilita (`UserAdminViewSet` ni
    // siquiera acepta DELETE — ver docs/AUDIT_LOG.md § 2026-08-07). Django
    // siempre mandó este campo, pero el adaptador lo descartaba: la lista
    // de usuarios quedaba idéntica después de dar de baja a alguien, sin
    // ninguna señal de que la operación había funcionado. Bug real
    // reportado en producción (ver docs/AUDIT_LOG.md § 2026-09-10).
    status: user.status,
    createdAt: user.created_at,
    dataConsentAccepted: user.data_consent_accepted,
    dataConsentAcceptedAt: user.data_consent_accepted_at,
  };
}

/** Recorre todas las páginas de `GET /admin/users/` — el frontend de Nexo
 * espera un array plano, no un sobre paginado. */
export async function fetchAllDjangoUsers(): Promise<DjangoUser[] | null> {
  const results: DjangoUser[] = [];
  let path: string | null = "/admin/users/?page_size=100";

  while (path) {
    const response = await djangoApiFetch(path);
    if (!response) return null;
    if (!response.ok) return null;

    const data = (await response.json()) as { results: DjangoUser[]; next: string | null };
    results.push(...data.results);
    path = data.next ? new URL(data.next).pathname.replace(/^\/api\/v1/, "") + new URL(data.next).search : null;
  }

  return results;
}

/** Resuelve el nombre de rol de Nexo (ej. "JEFE_NACIONAL") al id del
 * `Group` de Django correspondiente, para los endpoints que esperan
 * `role_ids`. */
export async function resolveRoleGroupId(roleName: string): Promise<number | null> {
  const response = await djangoApiFetch("/admin/roles/");
  if (!response || !response.ok) return null;

  const roles = (await response.json()) as { id: number; name: string }[];
  return roles.find((r) => r.name === roleName)?.id ?? null;
}
