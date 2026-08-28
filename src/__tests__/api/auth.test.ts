import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const getSession = vi.fn();
const createSession = vi.fn();
const deleteSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
  createSession: (...args: unknown[]) => createSession(...args),
  deleteSession: (...args: unknown[]) => deleteSession(...args),
}));

// Fase 6a (ver docs/AUDIT_LOG.md § 2026-08-14): el login pasó de
// Prisma/bcrypt/rate-limit.ts a Django — `src/lib/rate-limit.ts` ya no
// tiene consumidores en esta ruta. Fase 6b (ver docs/AUDIT_LOG.md §
// 2026-08-17): logout/me/change-password también pasan a Django. Fase 6c
// (ver docs/AUDIT_LOG.md § 2026-08-17): forgot-password/reset-password
// también.
const loginToDjango = vi.fn();
const setDjangoTokenCookies = vi.fn();
const clearDjangoTokenCookies = vi.fn();
const djangoApiFetch = vi.fn();
const extractDjangoFieldErrorMessage = vi.fn();
const requestDjangoPasswordReset = vi.fn();
const confirmDjangoPasswordReset = vi.fn();

vi.mock("@/lib/djangoSession", () => ({
  loginToDjango: (...args: unknown[]) => loginToDjango(...args),
  setDjangoTokenCookies: (...args: unknown[]) => setDjangoTokenCookies(...args),
  clearDjangoTokenCookies: (...args: unknown[]) => clearDjangoTokenCookies(...args),
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFieldErrorMessage: (...args: unknown[]) => extractDjangoFieldErrorMessage(...args),
  requestDjangoPasswordReset: (...args: unknown[]) => requestDjangoPasswordReset(...args),
  confirmDjangoPasswordReset: (...args: unknown[]) => confirmDjangoPasswordReset(...args),
}));

const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { POST: logoutPOST } = await import("@/app/api/auth/logout/route");
const { GET: meGET, PATCH: mePATCH } = await import("@/app/api/auth/me/route");
const { POST: changePasswordPOST } = await import("@/app/api/auth/change-password/route");
const { POST: forgotPasswordPOST } = await import("@/app/api/auth/forgot-password/route");
const { POST: resetPasswordPOST } = await import("@/app/api/auth/reset-password/route");
const { PATCH: consentPATCH } = await import("@/app/api/auth/consent/route");

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: new Headers(headers),
  } as never;
}

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

function resetAll() {
  getSession.mockReset();
  createSession.mockReset();
  deleteSession.mockReset();
  loginToDjango.mockReset();
  setDjangoTokenCookies.mockReset().mockResolvedValue(undefined);
  clearDjangoTokenCookies.mockReset().mockResolvedValue(undefined);
  djangoApiFetch.mockReset();
  extractDjangoFieldErrorMessage.mockReset().mockResolvedValue(undefined);
  requestDjangoPasswordReset.mockReset();
  confirmDjangoPasswordReset.mockReset();
}

function djangoMeResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    json: async () => ({
      id: 7,
      username: "ana",
      email: "a@nexo.com",
      first_name: "Ana",
      roles: [{ id: 1, name: "ASISTENTE_GH" }],
      legacy_postgres_id: "u1",
      ...overrides,
    }),
  };
}

describe("POST /api/auth/login", () => {
  beforeEach(resetAll);

  it("responde 400 si falta email o contraseña", async () => {
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com" }));
    expect(res.status).toBe(400);
    expect(loginToDjango).not.toHaveBeenCalled();
  });

  it("responde 401 con el mensaje de Django si las credenciales son inválidas", async () => {
    loginToDjango.mockResolvedValue({ ok: false, status: 401, message: "No fue posible iniciar sesión con esas credenciales." });
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "incorrecta" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("No fue posible iniciar sesión con esas credenciales.");
    expect(setDjangoTokenCookies).not.toHaveBeenCalled();
  });

  it("responde 503 si no se pudo conectar con Django", async () => {
    loginToDjango.mockResolvedValue({ ok: false, status: 503, message: "No se pudo conectar con el servicio de autenticación." });
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "x" }));
    expect(res.status).toBe(503);
  });

  it("con credenciales válidas: setea las cookies de Django, arma la sesión con el legacy_postgres_id y responde sin tokens", async () => {
    const tokens = { access: "acc", refresh: "ref", session_policy: { default_hours: 168, remember_hours: 720 } };
    loginToDjango.mockResolvedValue({ ok: true, tokens });
    djangoApiFetch.mockResolvedValue(djangoMeResponse());

    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "correcta", rememberMe: true }));

    expect(res.status).toBe(200);
    expect(setDjangoTokenCookies).toHaveBeenCalledWith(tokens);
    expect(createSession).toHaveBeenCalledWith(
      { userId: "u1", role: "ASISTENTE_GH", name: "Ana", email: "a@nexo.com", djangoUserId: 7 },
      true,
      720
    );
    const body = await res.json();
    expect(body).toEqual({ id: "u1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH" });
    expect(body).not.toHaveProperty("access");
    expect(body).not.toHaveProperty("password");
  });

  it("usa la duración default (no remember) cuando rememberMe no viene", async () => {
    const tokens = { access: "acc", refresh: "ref", session_policy: { default_hours: 168, remember_hours: 720 } };
    loginToDjango.mockResolvedValue({ ok: true, tokens });
    djangoApiFetch.mockResolvedValue(djangoMeResponse());

    await loginPOST(jsonRequest({ email: "a@nexo.com", password: "correcta" }));

    expect(createSession).toHaveBeenCalledWith(expect.anything(), false, 168);
  });

  it("responde 401 si el usuario de Django todavía no tiene legacy_postgres_id (no importado desde Postgres)", async () => {
    loginToDjango.mockResolvedValue({
      ok: true,
      tokens: { access: "acc", refresh: "ref", session_policy: { default_hours: 168, remember_hours: 720 } },
    });
    djangoApiFetch.mockResolvedValue(djangoMeResponse({ legacy_postgres_id: null }));

    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "correcta" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/no está sincronizado/);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("responde 500 si /auth/me falla justo después de un login exitoso", async () => {
    loginToDjango.mockResolvedValue({
      ok: true,
      tokens: { access: "acc", refresh: "ref", session_policy: { default_hours: 168, remember_hours: 720 } },
    });
    djangoApiFetch.mockResolvedValue(null);

    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "correcta" }));
    expect(res.status).toBe(500);
  });

  it("responde 500 ante un error inesperado, sin filtrar detalles internos", async () => {
    loginToDjango.mockRejectedValue(new Error("fallo inesperado"));
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "x" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Error del servidor");
  });
});

describe("POST /api/auth/logout", () => {
  beforeEach(resetAll);

  it("revoca la sesión de Django, limpia sus cookies y elimina la sesión de Next.js", async () => {
    djangoApiFetch.mockResolvedValue({ ok: true });
    deleteSession.mockResolvedValue(undefined);

    const res = await logoutPOST();

    expect(djangoApiFetch).toHaveBeenCalledWith("/auth/logout/", { method: "POST" });
    expect(clearDjangoTokenCookies).toHaveBeenCalled();
    expect(deleteSession).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("el logout de Next.js se completa igual si Django falla (best-effort)", async () => {
    djangoApiFetch.mockRejectedValue(new Error("Django caído"));
    deleteSession.mockResolvedValue(undefined);

    const res = await logoutPOST();

    expect(clearDjangoTokenCookies).toHaveBeenCalled();
    expect(deleteSession).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

function djangoMeGetResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    json: async () => ({
      id: 7,
      username: "ana",
      email: "a@nexo.com",
      first_name: "Ana",
      date_joined: "2026-01-01T00:00:00Z",
      roles: [{ id: 1, name: "ASISTENTE_GH" }],
      legacy_postgres_id: "u1",
      ...overrides,
    }),
  };
}

describe("GET /api/auth/me", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meGET();
    expect(res.status).toBe(401);
  });

  it("responde 401 si no hay sesión Django disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await meGET();
    expect(res.status).toBe(401);
  });

  it("responde 404 si Django no encuentra al usuario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: false });
    const res = await meGET();
    expect(res.status).toBe(404);
  });

  it("devuelve los datos del usuario autenticado, con activityFormat leído de Django", async () => {
    mockSession({});
    djangoApiFetch.mockImplementation(async (path: string) => {
      if (path === "/auth/me/") return djangoMeGetResponse();
      if (path === "/users/activity-format/") return { ok: true, json: async () => ({ activity_format: "timerange" }) };
      throw new Error(`ruta Django inesperada en el mock: ${path}`);
    });

    const res = await meGET();
    const body = await res.json();

    expect(body).toEqual({
      userId: "u1",
      name: "Ana",
      email: "a@nexo.com",
      role: "ASISTENTE_GH",
      createdAt: "2026-01-01T00:00:00Z",
      activityFormat: "timerange",
    });
  });
});

describe("PATCH /api/auth/me", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await mePATCH(jsonRequest({ name: "Ana", email: "a@nexo.com" }));
    expect(res.status).toBe(401);
  });

  it("responde 400 si falta el nombre o el correo", async () => {
    mockSession({});
    const res = await mePATCH(jsonRequest({ name: "  ", email: "a@nexo.com" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 si activityFormat no es un valor válido", async () => {
    mockSession({});
    const res = await mePATCH(jsonRequest({ activityFormat: "otro" }));
    expect(res.status).toBe(400);
  });

  it("responde 401 si no hay sesión Django disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await mePATCH(jsonRequest({ name: "Ana", email: "a@nexo.com" }));
    expect(res.status).toBe(401);
  });

  it("responde 400 con el mensaje de Django si el email ya está en uso por otro usuario", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: false });
    extractDjangoFieldErrorMessage.mockResolvedValue("Ese correo ya está registrado.");

    const res = await mePATCH(jsonRequest({ name: "Ana", email: "nuevo@nexo.com" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Ese correo ya está registrado.");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("actualiza nombre/email vía Django, renueva la sesión (con la duración resuelta desde Django) y normaliza el email a minúsculas", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockImplementation(async (path: string) => {
      if (path === "/auth/me/") return djangoMeGetResponse({ first_name: "Ana", email: "nuevo@nexo.com" });
      if (path === "/users/activity-format/") return { ok: true, json: async () => ({ activity_format: "duration" }) };
      if (path === "/settings/seguridad-config/") return { ok: true, json: async () => ({ session_duration_default_hours: 168 }) };
      throw new Error(`ruta Django inesperada en el mock: ${path}`);
    });

    const res = await mePATCH(jsonRequest({ name: "  Ana  ", email: "  NUEVO@nexo.com  " }));

    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/auth/me/", {
      method: "PATCH",
      body: JSON.stringify({ first_name: "Ana", email: "nuevo@nexo.com" }),
    });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/seguridad-config/");
    expect(createSession).toHaveBeenCalledWith(
      {
        userId: "u1",
        role: "ASISTENTE_GH",
        name: "Ana",
        email: "nuevo@nexo.com",
        djangoUserId: 7,
      },
      false,
      168
    );
    const body = await res.json();
    expect(body).toMatchObject({ userId: "u1", name: "Ana", email: "nuevo@nexo.com" });
  });

  it("actualiza solo activityFormat vía Django sin llamar PATCH de identidad ni renovar la sesión", async () => {
    mockSession({ userId: "u1" });
    const activityFormatPatch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ activity_format: "timerange" }) });
    djangoApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/auth/me/") return djangoMeGetResponse();
      if (path === "/users/activity-format/" && init?.method === "PATCH") return activityFormatPatch(path, init);
      if (path === "/users/activity-format/") return { ok: true, json: async () => ({ activity_format: "timerange" }) };
      throw new Error(`ruta Django inesperada en el mock: ${path}`);
    });

    const res = await mePATCH(jsonRequest({ activityFormat: "timerange" }));

    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/auth/me/");
    expect(createSession).not.toHaveBeenCalled();
    expect(activityFormatPatch).toHaveBeenCalledWith("/users/activity-format/", {
      method: "PATCH",
      body: JSON.stringify({ activity_format: "timerange" }),
    });
    const body = await res.json();
    expect(body.activityFormat).toBe("timerange");
  });
});

describe("POST /api/auth/change-password", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await changePasswordPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos", async () => {
    mockSession({});
    const res = await changePasswordPOST(jsonRequest({ currentPassword: "x" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 400 si la nueva contraseña es más corta que el mínimo configurado en Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: true, json: async () => ({ password_min_length: 6 }) });
    const res = await changePasswordPOST(jsonRequest({ currentPassword: "actual1", newPassword: "abc" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/seguridad-config/");
    expect(djangoApiFetch).not.toHaveBeenCalledWith("/auth/password/change/", expect.anything());
  });

  it("responde 401 si no hay sesión Django disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    // Sin respuesta de Django, fetchDjangoPasswordMinLength degrada al default (10, Fase 75) —
    // la nueva contraseña debe cumplir ese piso para llegar a la rama que este test verifica.
    const res = await changePasswordPOST(jsonRequest({ currentPassword: "actual1", newPassword: "nuevaPassword123" }));
    expect(res.status).toBe(401);
  });

  it("responde 400 con el mensaje de Django si la contraseña actual es incorrecta", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: false });
    extractDjangoFieldErrorMessage.mockResolvedValue("La contraseña actual no es correcta.");

    const res = await changePasswordPOST(jsonRequest({ currentPassword: "incorrecta", newPassword: "nuevaPassword123" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("La contraseña actual no es correcta.");
  });

  it("llama a Django con los campos mapeados a snake_case y confirmación duplicada", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue({ ok: true, json: async () => ({ password_min_length: 6 }) });

    const res = await changePasswordPOST(jsonRequest({ currentPassword: "correcta", newPassword: "nueva123" }));

    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/auth/password/change/", {
      method: "POST",
      body: JSON.stringify({
        current_password: "correcta",
        new_password: "nueva123",
        new_password_confirm: "nueva123",
      }),
    });
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /api/auth/forgot-password", () => {
  beforeEach(resetAll);

  it("responde 400 si falta el email", async () => {
    const res = await forgotPasswordPOST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(requestDjangoPasswordReset).not.toHaveBeenCalled();
  });

  it("devuelve siempre el mismo mensaje genérico de Django, exista o no la cuenta", async () => {
    requestDjangoPasswordReset.mockResolvedValue({
      message: "Si el dato ingresado corresponde a una cuenta, se enviará un enlace de recuperación al correo asociado.",
    });

    const res = await forgotPasswordPOST(jsonRequest({ email: "cualquiera@nexo.com" }));

    expect(res.status).toBe(200);
    expect(requestDjangoPasswordReset).toHaveBeenCalledWith("cualquiera@nexo.com");
    const body = await res.json();
    expect(body.message).toMatch(/Si el dato ingresado corresponde a una cuenta/);
  });
});

describe("POST /api/auth/reset-password", () => {
  beforeEach(resetAll);

  it("responde 400 si falta el token o la nueva contraseña", async () => {
    const res = await resetPasswordPOST(jsonRequest({ token: "abc" }));
    expect(res.status).toBe(400);
    expect(confirmDjangoPasswordReset).not.toHaveBeenCalled();
  });

  it("responde 400 con el mensaje de Django si el token es inválido o expiró", async () => {
    confirmDjangoPasswordReset.mockResolvedValue({
      ok: false,
      message: "El enlace de recuperación no es válido o expiró.",
    });

    const res = await resetPasswordPOST(jsonRequest({ token: "vencido", newPassword: "nueva123" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("El enlace de recuperación no es válido o expiró.");
  });

  it("con token válido: confirma el reset contra Django y responde ok", async () => {
    confirmDjangoPasswordReset.mockResolvedValue({ ok: true });

    const res = await resetPasswordPOST(jsonRequest({ token: "valido", newPassword: "nueva123" }));

    expect(res.status).toBe(200);
    expect(confirmDjangoPasswordReset).toHaveBeenCalledWith("valido", "nueva123");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("PATCH /api/auth/consent", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await consentPATCH();
    expect(res.status).toBe(401);
  });

  it("responde 401 si la sesión de Next.js todavía no tiene acceso a Django", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await consentPATCH();
    expect(res.status).toBe(401);
  });

  it("marca el consentimiento como aceptado con fecha", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data_consent_accepted: true, data_consent_accepted_at: "2026-01-01T00:00:00.000Z" }),
    });
    const res = await consentPATCH();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dataConsentAccepted: true, dataConsentAcceptedAt: "2026-01-01T00:00:00.000Z" });
    expect(djangoApiFetch).toHaveBeenCalledWith("/auth/consent/", { method: "PATCH" });
  });
});
