import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Fase 2 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// GET/PATCH/DELETE /api/users/[id] y POST reset-password pasaron de Prisma
// a Django (mockeados acá con `@/lib/djangoSession`). PATCH .../theme
// también se cortó a Django en la Fase 38, GET .../assignable en la Fase
// 42 (ver docs/AUDIT_LOG.md § 2026-08-21), reset-consent/reset-consent-all
// y view-preferences en la Fase 55 (ver docs/AUDIT_LOG.md § 2026-08-25) —
// este archivo ya no tiene ningún consumidor de `@/lib/prisma`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  // Réplica mínima de la real (Fase 40): usa `session.djangoUserId` si está,
  // si no cae a `djangoApiFetch("/auth/me/")` — mismo mock de `djangoApiFetch`
  // que el resto del archivo, para poder controlar ambos casos desde los tests.
  resolveDjangoUserId: async (session: { djangoUserId?: number }) => {
    if (typeof session.djangoUserId === "number") return session.djangoUserId;
    const response = await djangoApiFetch("/auth/me/");
    if (!response || !response.ok) return null;
    const me = await response.json();
    return me.id;
  },
}));

const { GET: userGET, PATCH: userPATCH, DELETE: userDELETE } = await import("@/app/api/users/[id]/route");
const { POST: resetPasswordPOST } = await import("@/app/api/users/[id]/reset-password/route");
const { PATCH: resetConsentPATCH } = await import("@/app/api/users/[id]/reset-consent/route");
const { PATCH: themePATCH } = await import("@/app/api/users/[id]/theme/route");
const { PATCH: viewPreferencesPATCH } = await import("@/app/api/users/[id]/view-preferences/route");
const { GET: assignableGET } = await import("@/app/api/users/assignable/route");
const { PATCH: resetConsentAllPATCH } = await import("@/app/api/users/reset-consent-all/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "JEFE_NACIONAL",
          name: "Test",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown = {}) {
  return { json: async () => body } as never;
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
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

/** `GET /admin/users/[id]/` responde con `djangoUser(overrides)`, cualquier otra llamada 200 vacío. */
function mockFetchUser(overrides: Partial<Record<string, unknown>> = {}, ok = true) {
  djangoApiFetch.mockImplementation(async (path: string) => {
    if (/\/admin\/users\/\d+\/$/.test(path)) return ok ? djangoResponse(true, djangoUser(overrides)) : djangoResponse(false, {}, 404);
    return djangoResponse(true, {});
  });
}

describe("GET /api/users/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin gestión de usuarios", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    mockFetchUser({}, false);
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 404 (no 403, para no filtrar existencia) si el objetivo está fuera de la jerarquía visible", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    mockFetchUser({ roles: [{ id: 1, name: "JEFE_NACIONAL" }] });
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("ADMINISTRADOR puede ver a cualquier usuario, incluido otro Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    mockFetchUser({ roles: [{ id: 1, name: "ADMINISTRADOR" }] });
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(200);
  });

  it("un gestor ve el detalle de un usuario dentro de su jerarquía visible", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    mockFetchUser({ roles: [{ id: 1, name: "ASISTENTE_GH" }] });
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/users/[id]", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await userPATCH(jsonRequest({}), ctx())).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await userPATCH(jsonRequest({}), ctx())).status).toBe(403);
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    mockFetchUser({}, false);
    const res = await userPATCH(jsonRequest({ name: "Ana" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si un no-Administrador intenta editar a un Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    mockFetchUser({ roles: [{ id: 1, name: "ADMINISTRADOR" }] });
    const res = await userPATCH(jsonRequest({ name: "Ana" }), ctx());
    expect(res.status).toBe(403);
  });

  it("un Administrador sí puede editar a otro Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    mockFetchUser({ roles: [{ id: 1, name: "ADMINISTRADOR" }] });
    const res = await userPATCH(jsonRequest({ name: "Ana" }), ctx());
    expect(res.status).toBe(200);
  });

  it("responde 403 si alguien que no es Jefe Nacional ni Administrador intenta editar a un Jefe Nacional", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    mockFetchUser({ roles: [{ id: 1, name: "JEFE_NACIONAL" }] });
    const res = await userPATCH(jsonRequest({ name: "Ana" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 400 ante un rol inválido", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    mockFetchUser({});
    const res = await userPATCH(jsonRequest({ role: "SUPERADMIN" }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 403 al intentar asignar un rol superior al del solicitante", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" }); // nivel 3
    mockFetchUser({});
    const res = await userPATCH(jsonRequest({ role: "JEFE_NACIONAL" }), ctx()); // nivel 4
    expect(res.status).toBe(403);
  });

  it("responde 409 si Django rechaza el nuevo email por colisión", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return djangoResponse(false, {}, 409);
      return djangoResponse(true, djangoUser());
    });
    const res = await userPATCH(jsonRequest({ email: "duplicado@nexo.com" }), ctx());
    expect(res.status).toBe(409);
  });

  it("edita el perfil y el rol, y devuelve el usuario actualizado mapeado a la forma Nexo", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/roles/") return djangoResponse(true, [{ id: 9, name: "COORDINADOR_ZS" }]);
      if (init?.method === "PATCH") {
        expect(JSON.parse(init.body as string)).toEqual({ first_name: "Ana" });
        return djangoResponse(true, {});
      }
      if (init?.method === "POST") {
        expect(JSON.parse(init.body as string)).toEqual({ role_ids: [9] });
        return djangoResponse(true, {});
      }
      return djangoResponse(true, djangoUser({ first_name: "Ana", roles: [{ id: 9, name: "COORDINADOR_ZS" }] }));
    });

    const res = await userPATCH(jsonRequest({ name: "  Ana  ", role: "COORDINADOR_ZS" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ name: "Ana", role: "COORDINADOR_ZS" });
  });
});

describe("DELETE /api/users/[id]", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await userDELETE(jsonRequest(), ctx())).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await userDELETE(jsonRequest(), ctx())).status).toBe(403);
  });

  it("responde 400 al intentar eliminarse a sí mismo", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: "1" });
    const res = await userDELETE(jsonRequest(), ctx("1"));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si el objetivo no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    mockFetchUser({}, false);
    const res = await userDELETE(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 404 si el objetivo está fuera de la jerarquía visible (IDOR)", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    mockFetchUser({ roles: [{ id: 1, name: "JEFE_NACIONAL" }] });
    const res = await userDELETE(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("deshabilita (baja lógica) al usuario cuando está dentro de la jerarquía visible", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(path).toBe("/admin/users/1/disable/");
        return djangoResponse(true, {});
      }
      return djangoResponse(true, djangoUser());
    });
    const res = await userDELETE(jsonRequest(), ctx());
    expect(res.status).toBe(200);
  });

  it("responde 500 si Django no puede deshabilitar al usuario", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return djangoResponse(false, {}, 500);
      return djangoResponse(true, djangoUser());
    });
    const res = await userDELETE(jsonRequest(), ctx());
    expect(res.status).toBe(500);
  });
});

describe("POST /api/users/[id]/reset-password", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await resetPasswordPOST(jsonRequest(), ctx())).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await resetPasswordPOST(jsonRequest(), ctx())).status).toBe(403);
  });

  it("responde 404 si el usuario no existe o está fuera de la jerarquía visible", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    mockFetchUser({ roles: [{ id: 1, name: "JEFE_NACIONAL" }] });
    const res = await resetPasswordPOST(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("fuerza el cambio de contraseña en el próximo login y revoca sesiones, confirmando con el nombre", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(path).toBe("/admin/users/1/password-reset/");
        expect(JSON.parse(init.body as string)).toEqual({ force_change_on_next_login: true, revoke_sessions: true });
        return djangoResponse(true, {});
      }
      return djangoResponse(true, djangoUser({ first_name: "Ana" }));
    });

    const res = await resetPasswordPOST(jsonRequest(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("Ana");
  });
});

describe("PATCH /api/users/[id]/reset-consent", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y permisos", async () => {
    mockSession(null);
    expect((await resetConsentPATCH(jsonRequest(), ctx())).status).toBe(401);
    mockSession({ role: "ASISTENTE_GH" });
    expect((await resetConsentPATCH(jsonRequest(), ctx())).status).toBe(403);
  });

  it("responde 404 si está fuera de la jerarquía visible", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    mockFetchUser({ roles: [{ id: 1, name: "JEFE_NACIONAL" }] });
    const res = await resetConsentPATCH(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 401 si la sesión de Next.js todavía no tiene acceso a Django", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await resetConsentPATCH(jsonRequest(), ctx());
    expect(res.status).toBe(401);
  });

  it("restablece el consentimiento a no aceptado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (path: string) => {
      if (/\/admin\/users\/\d+\/$/.test(path)) return djangoResponse(true, djangoUser({ id: 7, roles: [{ id: 5, name: "ASISTENTE_GH" }] }));
      if (/\/admin\/users\/\d+\/reset-consent\/$/.test(path)) return djangoResponse(true, djangoUser({ id: 7 }));
      return djangoResponse(true, {});
    });
    const res = await resetConsentPATCH(jsonRequest(), ctx("7"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/admin/users/7/reset-consent/", { method: "POST" });
  });
});

describe("PATCH /api/users/[id]/theme", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx());
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si se intenta cambiar el tema de otro usuario", async () => {
    mockSession({ userId: "u1" });
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx("otro-usuario"));
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 ante un valor de tema inválido", async () => {
    mockSession({ userId: "u1" });
    const res = await themePATCH(jsonRequest({ theme: "PURPLE" }), ctx("u1"));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible al resolver /auth/me/", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx("u1"));
    expect(res.status).toBe(401);
  });

  it("con djangoUserId ya en la sesión (Fase 40), no llama a /auth/me/", async () => {
    mockSession({ userId: "u1", djangoUserId: 7 });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { theme: "DARK" }));
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx("u1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledTimes(1);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/users/7/theme/",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("sin djangoUserId en la sesión (previa a la Fase 40), resuelve el id numérico vía /auth/me/ y actualiza el propio tema", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockImplementation(async (path: string) => {
      if (path === "/auth/me/") return djangoResponse(true, { id: 7 });
      if (path === "/users/7/theme/") return djangoResponse(true, { theme: "DARK" });
      throw new Error(`unexpected path ${path}`);
    });
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx("u1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ theme: "DARK" });
  });

  it("propaga el rechazo de Django (theme inválido para UserThemeView)", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockImplementation(async (path: string) => {
      if (path === "/auth/me/") return djangoResponse(true, { id: 7 });
      return djangoResponse(false, { error: "theme debe ser LIGHT o DARK" }, 400);
    });
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx("u1"));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/users/[id]/view-preferences", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await viewPreferencesPATCH(jsonRequest({ viewPreferences: ["kanban"] }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si se intenta cambiar las preferencias de otro usuario", async () => {
    mockSession({ userId: "u1" });
    const res = await viewPreferencesPATCH(jsonRequest({ viewPreferences: ["kanban"] }), ctx("otro-usuario"));
    expect(res.status).toBe(403);
  });

  it("responde 400 si viewPreferences no es un array no vacío", async () => {
    mockSession({ userId: "u1" });
    expect((await viewPreferencesPATCH(jsonRequest({ viewPreferences: [] }), ctx("u1"))).status).toBe(400);
    expect((await viewPreferencesPATCH(jsonRequest({ viewPreferences: "kanban" }), ctx("u1"))).status).toBe(400);
  });

  it("responde 401 si la sesión de Next.js todavía no tiene acceso a Django", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await viewPreferencesPATCH(jsonRequest({ viewPreferences: ["kanban", "tabla"] }), ctx("u1"));
    expect(res.status).toBe(401);
  });

  it("actualiza las propias preferencias de vista", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { view_preferences: ["kanban", "tabla"] }));
    const res = await viewPreferencesPATCH(jsonRequest({ viewPreferences: ["kanban", "tabla"] }), ctx("u1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewPreferences: ["kanban", "tabla"] });
    expect(djangoApiFetch).toHaveBeenCalledWith("/users/u1/view-preferences/", {
      method: "PATCH",
      body: JSON.stringify({ viewPreferences: ["kanban", "tabla"] }),
    });
  });
});

describe("GET /api/users/assignable", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await assignableGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({ role: "ANALISTA_CC" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await assignableGET();
    expect(res.status).toBe(401);
  });

  it("mapea la lista de Django a la forma Nexo (id como string)", async () => {
    mockSession({ role: "ANALISTA_CC" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [{ id: 7, name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH" }])
    );
    const res = await assignableGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "7", name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH" }]);
    expect(djangoApiFetch).toHaveBeenCalledWith("/users/assignable/");
  });
});

describe("PATCH /api/users/reset-consent-all", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await resetConsentAllPATCH();
    expect(res.status).toBe(401);
  });

  it("responde 403 si quien solicita no es Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await resetConsentAllPATCH();
    expect(res.status).toBe(403);
  });

  it("responde 401 si la sesión de Next.js todavía no tiene acceso a Django", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await resetConsentAllPATCH();
    expect(res.status).toBe(401);
  });

  it("un Administrador restablece el consentimiento de todos y recibe el conteo", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true, count: 42 }));
    const res = await resetConsentAllPATCH();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, count: 42 });
    expect(djangoApiFetch).toHaveBeenCalledWith("/admin/users/reset-consent-all/", { method: "POST" });
  });
});
