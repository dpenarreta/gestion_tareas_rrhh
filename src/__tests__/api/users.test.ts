import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";

// Fase 2 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// GET/POST /api/users pasaron de Prisma a Django — este archivo mockeaba
// `@/lib/prisma` hasta esta actualización. Acá se cubre lo que el wrapper
// de Next.js realmente hace: sesión, permisos, filtrado por jerarquía
// (post-filtro porque Django no conoce `apps.hierarchy` todavía),
// enmascarado de email, forwarding a Django — mismo criterio que
// `auth.test.ts` tras su propio cutover.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET, POST } = await import("@/app/api/users/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Test",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function postRequest(body: unknown) {
  return { json: async () => body } as never;
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

function djangoUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    username: "ana",
    email: "ana@example.com",
    first_name: "Ana",
    last_name: "",
    status: "active",
    is_superuser: false,
    must_change_password: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_login: null,
    roles: [{ id: 5, name: "ASISTENTE_GH" }],
    ...overrides,
  };
}

/** `fetchAllDjangoUsers` pagina — una sola página alcanza para estos tests. */
function mockUsersPage(users: unknown[]) {
  djangoApiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/admin/users/")) return djangoResponse(true, { results: users, next: null });
    return djangoResponse(false, {}, 404);
  });
}

describe("GET /api/users", () => {
  beforeEach(() => {
    getSession.mockReset();
    djangoApiFetch.mockReset();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de gestión de usuarios (ASISTENTE_GH)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 para un rol de nivel intermedio sin permiso (COORDINADOR_ZS)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("ADMINISTRADOR ve a todos, sin filtro de jerarquía", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    mockUsersPage([djangoUser({ id: 1, roles: [{ id: 1, name: "ASISTENTE_GH" }] }), djangoUser({ id: 2, roles: [{ id: 2, name: "JEFE_NACIONAL" }] })]);

    const res = await GET();
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it("un rol gestor no-Administrador solo ve sus roles visibles (lo que excluye siempre a ADMINISTRADOR)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const visible = getVisibleRoles("JEFE_NACIONAL");
    mockUsersPage([
      djangoUser({ id: 1, roles: [{ id: 1, name: visible[0] }] }),
      djangoUser({ id: 2, roles: [{ id: 2, name: "ADMINISTRADOR" }] }),
    ]);

    const res = await GET();
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].role).toBe(visible[0]);
  });

  it("enmascara el email de cada usuario en la respuesta", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    mockUsersPage([djangoUser({ email: "ana@example.com" })]);

    const res = await GET();
    const body = await res.json();
    expect(body[0].email).toBe("a**@e*****.com");
    expect(body[0].email).not.toBe("ana@example.com");
  });
});

describe("POST /api/users", () => {
  beforeEach(() => {
    getSession.mockReset();
    djangoApiFetch.mockReset();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de gestión de usuarios", async () => {
    mockSession({ role: "ANALISTA_CC" });
    const res = await POST(postRequest({}));
    expect(res.status).toBe(403);
  });

  it("responde 400 si falta algún campo requerido", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await POST(postRequest({ name: "Ana", email: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/requeridos/);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si se intenta asignar un rol superior al del solicitante", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" }); // nivel 3
    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "JEFE_NACIONAL" })); // nivel 4
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/rol superior/);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no puede resolver el grupo del rol (sin sesión Django)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string) =>
      path === "/admin/roles/" ? null : djangoResponse(true, djangoUser())
    );
    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH" }));
    expect(res.status).toBe(401);
  });

  it("permite asignar un rol del mismo nivel jerárquico que el del solicitante", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string) => {
      if (path === "/admin/roles/") return djangoResponse(true, [{ id: 9, name: "COORDINADOR_NACIONAL" }]);
      return djangoResponse(true, djangoUser({ roles: [{ id: 9, name: "COORDINADOR_NACIONAL" }] }), 201);
    });
    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "COORDINADOR_NACIONAL" }));
    expect(res.status).toBe(201);
  });

  it("responde 409 si Django rechaza por email ya registrado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string) => {
      if (path === "/admin/roles/") return djangoResponse(true, [{ id: 9, name: "ASISTENTE_GH" }]);
      return djangoResponse(false, { error: { details: { email: ["Ya existe"] } } }, 409);
    });
    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/ya está registrado/);
  });

  it("crea el usuario y devuelve 201 con la forma Nexo, sin exponer la contraseña", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/roles/") return djangoResponse(true, [{ id: 9, name: "ASISTENTE_GH" }]);
      expect(path).toBe("/admin/users/");
      const sentBody = JSON.parse(init!.body as string);
      expect(sentBody).toMatchObject({ username: "ana@nexo.com", email: "ana@nexo.com", first_name: "Ana", role_ids: [9] });
      expect(sentBody.password).not.toBe("123456");
      return djangoResponse(true, djangoUser({ id: 42, email: "ana@nexo.com", first_name: "Ana" }), 201);
    });

    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: "42", name: "Ana", email: "ana@nexo.com" });
    expect(body).not.toHaveProperty("password");
  });
});
