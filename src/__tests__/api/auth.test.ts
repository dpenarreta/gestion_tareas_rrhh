import { describe, expect, it, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import type { SessionPayload } from "@/lib/session";

const findUnique = vi.fn();
const userUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique, update: userUpdate } },
}));

const getSession = vi.fn();
const createSession = vi.fn();
const deleteSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
  createSession: (...args: unknown[]) => createSession(...args),
  deleteSession: (...args: unknown[]) => deleteSession(...args),
}));

const isRateLimited = vi.fn();
const registerFailedAttempt = vi.fn();
const clearAttempts = vi.fn();
const getBlockedMinutesRemaining = vi.fn();
const cleanupExpiredLoginAttempts = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimited(...args),
  registerFailedAttempt: (...args: unknown[]) => registerFailedAttempt(...args),
  clearAttempts: (...args: unknown[]) => clearAttempts(...args),
  getBlockedMinutesRemaining: (...args: unknown[]) => getBlockedMinutesRemaining(...args),
  cleanupExpiredLoginAttempts: (...args: unknown[]) => cleanupExpiredLoginAttempts(...args),
  getClientIp: (headers: Headers) => headers.get("x-forwarded-for") ?? "unknown",
}));

const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { POST: logoutPOST } = await import("@/app/api/auth/logout/route");
const { GET: meGET, PATCH: mePATCH } = await import("@/app/api/auth/me/route");
const { POST: changePasswordPOST } = await import("@/app/api/auth/change-password/route");
const { POST: forgotPasswordPOST } = await import("@/app/api/auth/forgot-password/route");
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
  findUnique.mockReset();
  userUpdate.mockReset();
  getSession.mockReset();
  createSession.mockReset();
  deleteSession.mockReset();
  isRateLimited.mockReset().mockResolvedValue(false);
  registerFailedAttempt.mockReset().mockResolvedValue(undefined);
  clearAttempts.mockReset().mockResolvedValue(undefined);
  getBlockedMinutesRemaining.mockReset();
  cleanupExpiredLoginAttempts.mockReset().mockResolvedValue(0);
}

describe("POST /api/auth/login", () => {
  beforeEach(resetAll);

  it("responde 429 y no consulta credenciales si la IP está bloqueada", async () => {
    isRateLimited.mockResolvedValue(true);
    getBlockedMinutesRemaining.mockResolvedValue(5);
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "x" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/5 minutos/);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("usa singular 'minuto' cuando queda exactamente 1", async () => {
    isRateLimited.mockResolvedValue(true);
    getBlockedMinutesRemaining.mockResolvedValue(1);
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "x" }));
    const body = await res.json();
    expect(body.error).toMatch(/1 minuto\b/);
    expect(body.error).not.toMatch(/1 minutos/);
  });

  it("responde 400 si falta email o contraseña", async () => {
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com" }));
    expect(res.status).toBe(400);
  });

  it("responde 401 y registra el intento fallido si el usuario no existe", async () => {
    findUnique.mockResolvedValue(null);
    const res = await loginPOST(jsonRequest({ email: "noexiste@nexo.com", password: "x" }));
    expect(res.status).toBe(401);
    expect(registerFailedAttempt).toHaveBeenCalledWith("unknown");
  });

  it("responde 401 y registra el intento fallido si la contraseña es incorrecta", async () => {
    const hash = await bcrypt.hash("correcta", 4);
    findUnique.mockResolvedValue({ id: "u1", email: "a@nexo.com", password: hash, role: "ASISTENTE_GH", name: "Ana" });
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "incorrecta" }));
    expect(res.status).toBe(401);
    expect(registerFailedAttempt).toHaveBeenCalled();
  });

  it("con credenciales válidas: limpia intentos, actualiza lastLoginAt, crea sesión y responde sin la contraseña", async () => {
    const hash = await bcrypt.hash("correcta", 4);
    findUnique.mockResolvedValue({ id: "u1", email: "a@nexo.com", password: hash, role: "ASISTENTE_GH", name: "Ana" });
    userUpdate.mockResolvedValue({});

    const res = await loginPOST(
      jsonRequest({ email: "a@nexo.com", password: "correcta", rememberMe: true }, { "x-forwarded-for": "1.2.3.4" })
    );

    expect(res.status).toBe(200);
    expect(clearAttempts).toHaveBeenCalledWith("1.2.3.4");
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { lastLoginAt: expect.any(Date) } });
    expect(createSession).toHaveBeenCalledWith(
      { userId: "u1", role: "ASISTENTE_GH", name: "Ana", email: "a@nexo.com" },
      true
    );
    const body = await res.json();
    expect(body).toEqual({ id: "u1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH" });
    expect(body).not.toHaveProperty("password");
  });

  it("responde 500 ante un error inesperado, sin filtrar detalles internos", async () => {
    findUnique.mockRejectedValue(new Error("DB caída"));
    const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "x" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Error del servidor");
  });

  it("dispara la limpieza de LoginAttempt expirados en el ~1% de las llamadas (muestreo)", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      findUnique.mockResolvedValue(null);
      await loginPOST(jsonRequest({ email: "noexiste@nexo.com", password: "x" }));
      expect(cleanupExpiredLoginAttempts).toHaveBeenCalledTimes(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("no dispara la limpieza fuera de la muestra (~99% de las llamadas)", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      findUnique.mockResolvedValue(null);
      await loginPOST(jsonRequest({ email: "noexiste@nexo.com", password: "x" }));
      expect(cleanupExpiredLoginAttempts).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("no ejecuta la limpieza si la IP ya está bloqueada (corta antes de la muestra)", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      isRateLimited.mockResolvedValue(true);
      getBlockedMinutesRemaining.mockResolvedValue(5);
      await loginPOST(jsonRequest({ email: "a@nexo.com", password: "x" }));
      expect(cleanupExpiredLoginAttempts).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("un error en la limpieza en segundo plano no interrumpe el login", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      cleanupExpiredLoginAttempts.mockRejectedValue(new Error("fallo de limpieza"));
      const hash = await bcrypt.hash("correcta", 4);
      findUnique.mockResolvedValue({ id: "u1", email: "a@nexo.com", password: hash, role: "ASISTENTE_GH", name: "Ana" });
      userUpdate.mockResolvedValue({});
      const res = await loginPOST(jsonRequest({ email: "a@nexo.com", password: "correcta" }));
      expect(res.status).toBe(200);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe("POST /api/auth/logout", () => {
  it("elimina la sesión y responde ok", async () => {
    deleteSession.mockResolvedValue(undefined);
    const res = await logoutPOST();
    expect(deleteSession).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/auth/me", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meGET();
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario de la sesión ya no existe", async () => {
    mockSession({});
    findUnique.mockResolvedValue(null);
    const res = await meGET();
    expect(res.status).toBe(404);
  });

  it("devuelve los datos del usuario autenticado", async () => {
    mockSession({});
    findUnique.mockResolvedValue({ id: "u1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", createdAt: new Date("2026-01-01") });
    const res = await meGET();
    const body = await res.json();
    expect(body).toMatchObject({ userId: "u1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH" });
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
  });

  it("no consulta duplicados si el email no cambió", async () => {
    mockSession({ email: "a@nexo.com" });
    userUpdate.mockResolvedValue({ id: "u1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", createdAt: new Date() });
    await mePATCH(jsonRequest({ name: "Ana", email: "a@nexo.com" }));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("responde 409 si el nuevo email ya está en uso por otro usuario", async () => {
    mockSession({ email: "old@nexo.com" });
    findUnique.mockResolvedValue({ id: "otro-usuario" });
    const res = await mePATCH(jsonRequest({ name: "Ana", email: "nuevo@nexo.com" }));
    expect(res.status).toBe(409);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("actualiza el perfil, renueva la sesión y normaliza el email a minúsculas", async () => {
    mockSession({ userId: "u1", email: "old@nexo.com" });
    findUnique.mockResolvedValue(null);
    userUpdate.mockResolvedValue({ id: "u1", name: "Ana", email: "nuevo@nexo.com", role: "ASISTENTE_GH", createdAt: new Date() });

    const res = await mePATCH(jsonRequest({ name: "  Ana  ", email: "  NUEVO@nexo.com  " }));
    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Ana", email: "nuevo@nexo.com" } })
    );
    expect(createSession).toHaveBeenCalledWith({ userId: "u1", role: "ASISTENTE_GH", name: "Ana", email: "nuevo@nexo.com" });
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
  });

  it("responde 400 si la nueva contraseña tiene menos de 6 caracteres", async () => {
    mockSession({});
    const res = await changePasswordPOST(jsonRequest({ currentPassword: "actual1", newPassword: "abc" }));
    expect(res.status).toBe(400);
  });

  it("responde 404 si el usuario ya no existe", async () => {
    mockSession({});
    findUnique.mockResolvedValue(null);
    const res = await changePasswordPOST(jsonRequest({ currentPassword: "actual1", newPassword: "nueva123" }));
    expect(res.status).toBe(404);
  });

  it("responde 400 si la contraseña actual es incorrecta", async () => {
    mockSession({});
    const hash = await bcrypt.hash("correcta", 4);
    findUnique.mockResolvedValue({ id: "u1", password: hash });
    const res = await changePasswordPOST(jsonRequest({ currentPassword: "incorrecta", newPassword: "nueva123" }));
    expect(res.status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("actualiza la contraseña con un hash distinto al texto plano", async () => {
    mockSession({ userId: "u1" });
    const hash = await bcrypt.hash("correcta", 4);
    findUnique.mockResolvedValue({ id: "u1", password: hash });
    userUpdate.mockResolvedValue({});

    const res = await changePasswordPOST(jsonRequest({ currentPassword: "correcta", newPassword: "nueva123" }));
    expect(res.status).toBe(200);
    const call = userUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: "u1" });
    expect(call.data.password).not.toBe("nueva123");
  });
});

describe("POST /api/auth/forgot-password", () => {
  beforeEach(resetAll);

  it("responde 400 si falta el email", async () => {
    const res = await forgotPasswordPOST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("responde 200 con mensaje genérico aunque el email no exista (no revela existencia de la cuenta)", async () => {
    findUnique.mockResolvedValue(null);
    const res = await forgotPasswordPOST(jsonRequest({ email: "noexiste@nexo.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/Si el email/);
  });

  it("responde 200 con mensaje de envío si el email existe", async () => {
    findUnique.mockResolvedValue({ id: "u1" });
    const res = await forgotPasswordPOST(jsonRequest({ email: "existe@nexo.com" }));
    const body = await res.json();
    expect(body.message).toMatch(/Se enviaría un correo/);
  });
});

describe("PATCH /api/auth/consent", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await consentPATCH();
    expect(res.status).toBe(401);
  });

  it("marca el consentimiento como aceptado con fecha", async () => {
    mockSession({ userId: "u1" });
    userUpdate.mockResolvedValue({ dataConsentAccepted: true, dataConsentAcceptedAt: new Date("2026-01-01") });
    const res = await consentPATCH();
    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { dataConsentAccepted: true, dataConsentAcceptedAt: expect.any(Date) },
      select: { dataConsentAccepted: true, dataConsentAcceptedAt: true },
    });
  });
});
