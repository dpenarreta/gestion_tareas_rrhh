import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Catálogo de permisos, de solo lectura (`GET /admin/permissions/`) — ver
// docs/AUDIT_LOG.md § 2026-09-01. Proxy directo: la forma del catálogo ya
// es la que necesita la pantalla, sin adaptador snake_case->camelCase.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const fetchDjangoPermissionCatalog = vi.fn();
vi.mock("@/lib/djangoRolesAdapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/djangoRolesAdapter")>("@/lib/djangoRolesAdapter");
  return { ...actual, fetchDjangoPermissionCatalog: (...args: unknown[]) => fetchDjangoPermissionCatalog(...args) };
});

const { GET } = await import("@/app/api/admin/permissions/route");

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

function resetAll() {
  getSession.mockReset();
  fetchDjangoPermissionCatalog.mockReset();
}

describe("GET /api/admin/permissions", () => {
  beforeEach(resetAll);

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(fetchDjangoPermissionCatalog).not.toHaveBeenCalled();
  });

  it("responde 401 si Django todavía no reconoce la sesión", async () => {
    mockSession({});
    fetchDjangoPermissionCatalog.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("devuelve el catálogo sin transformar", async () => {
    mockSession({});
    const catalog = { usuarios: { label: "Usuarios", description: "...", permissions: { "usuarios.ver": "Ver usuarios" } } };
    fetchDjangoPermissionCatalog.mockResolvedValue(catalog);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(catalog);
  });
});
