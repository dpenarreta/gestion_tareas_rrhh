import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// "Roles y Permisos" (`/admin/roles`) — ver docs/AUDIT_LOG.md § 2026-09-01.
// GET lista roles (Django ya gatea por `roles.ver`, sin duplicar el check
// acá); PATCH reemplaza el set completo de permisos de un rol y sí duplica
// el check (`canManageRoles`) como defensa en profundidad, igual criterio
// que `role-compatibility/route.ts`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const fetchDjangoRoles = vi.fn();
const patchDjangoRolePermissions = vi.fn();
vi.mock("@/lib/djangoRolesAdapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/djangoRolesAdapter")>("@/lib/djangoRolesAdapter");
  return {
    ...actual,
    fetchDjangoRoles: (...args: unknown[]) => fetchDjangoRoles(...args),
    patchDjangoRolePermissions: (...args: unknown[]) => patchDjangoRolePermissions(...args),
  };
});

const { GET } = await import("@/app/api/admin/roles/route");
const { PATCH } = await import("@/app/api/admin/roles/[id]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          djangoUserId: 1,
          role: "ADMINISTRADOR",
          name: "Ana",
          email: "a@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          permissions: [],
          ...overrides,
        }
  );
}

function patchRequest(body: unknown) {
  return { json: async () => body } as never;
}

function resetAll() {
  getSession.mockReset();
  fetchDjangoRoles.mockReset();
  patchDjangoRolePermissions.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/admin/roles", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(fetchDjangoRoles).not.toHaveBeenCalled();
  });

  it("responde 401 si Django todavía no reconoce la sesión", async () => {
    mockSession({});
    fetchDjangoRoles.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("mapea los roles snake_case -> camelCase", async () => {
    mockSession({});
    fetchDjangoRoles.mockResolvedValue([
      { id: 3, name: "JEFE_NACIONAL", permission_codenames: ["usuarios.ver", "roles.ver"] },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: "3", name: "JEFE_NACIONAL", permissionCodenames: ["usuarios.ver", "roles.ver"] }]);
  });
});

describe("PATCH /api/admin/roles/[id]", () => {
  beforeEach(resetAll);

  const ctx = { params: Promise.resolve({ id: "3" }) };

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await PATCH(patchRequest({ permissionCodenames: ["roles.ver"] }), ctx);
    expect(res.status).toBe(401);
    expect(patchDjangoRolePermissions).not.toHaveBeenCalled();
  });

  it("responde 403 sin roles.editar en la sesión, sin llamar a Django", async () => {
    mockSession({ permissions: ["roles.ver"] });
    const res = await PATCH(patchRequest({ permissionCodenames: ["roles.ver"] }), ctx);
    expect(res.status).toBe(403);
    expect(patchDjangoRolePermissions).not.toHaveBeenCalled();
  });

  it("responde 400 si permissionCodenames no es una lista de strings", async () => {
    mockSession({ permissions: ["roles.editar"] });
    const res = await PATCH(patchRequest({ permissionCodenames: "no-es-array" }), ctx);
    expect(res.status).toBe(400);
    expect(patchDjangoRolePermissions).not.toHaveBeenCalled();
  });

  it("responde 401 si Django todavía no reconoce la sesión", async () => {
    mockSession({ permissions: ["roles.editar"] });
    patchDjangoRolePermissions.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ permissionCodenames: ["roles.ver"] }), ctx);
    expect(res.status).toBe(401);
  });

  it("propaga el error de campo de Django (contrato anidado)", async () => {
    mockSession({ permissions: ["roles.editar"] });
    patchDjangoRolePermissions.mockResolvedValue(
      djangoResponse(false, { error: { details: { permission_codenames: ["Codename desconocido: foo.bar"] } } }, 400)
    );
    const res = await PATCH(patchRequest({ permissionCodenames: ["foo.bar"] }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Codename desconocido: foo.bar");
  });

  it("guarda el set completo de codenames y mapea la respuesta", async () => {
    mockSession({ permissions: ["roles.editar"] });
    patchDjangoRolePermissions.mockResolvedValue(
      djangoResponse(true, { id: 3, name: "JEFE_NACIONAL", permission_codenames: ["reportes.ver"] })
    );
    const res = await PATCH(patchRequest({ permissionCodenames: ["reportes.ver"] }), ctx);
    expect(patchDjangoRolePermissions).toHaveBeenCalledWith("3", ["reportes.ver"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "3", name: "JEFE_NACIONAL", permissionCodenames: ["reportes.ver"] });
  });
});
