import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const findUnique = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const deleteUser = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique, update, updateMany, delete: deleteUser, findMany } },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: userGET, PATCH: userPATCH, DELETE: userDELETE } = await import("@/app/api/users/[id]/route");
const { POST: resetPasswordPOST } = await import("@/app/api/users/[id]/reset-password/route");
const { PATCH: resetConsentPATCH } = await import("@/app/api/users/[id]/reset-consent/route");
const { PATCH: themePATCH } = await import("@/app/api/users/[id]/theme/route");
const { PATCH: viewPreferencesPATCH } = await import("@/app/api/users/[id]/view-preferences/route");
const { GET: assignableGET } = await import("@/app/api/users/assignable/route");
const { PATCH: resetConsentAllPATCH } = await import("@/app/api/users/reset-consent-all/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
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

function ctx(id = "target-1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown = {}) {
  return { json: async () => body } as never;
}

function resetAll() {
  findUnique.mockReset();
  update.mockReset();
  updateMany.mockReset();
  deleteUser.mockReset();
  findMany.mockReset();
  vi.mocked(getSession).mockReset();
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

  it("responde 404 si el usuario no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue(null);
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 404 (no 403, para no filtrar existencia) si el objetivo está fuera de la jerarquía visible", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "JEFE_NACIONAL" });
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("ADMINISTRADOR puede ver a cualquier usuario, incluido otro Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ADMINISTRADOR", name: "Otro Admin" });
    const res = await userGET(jsonRequest(), ctx());
    expect(res.status).toBe(200);
  });

  it("un gestor ve el detalle de un usuario dentro de su jerarquía visible", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ASISTENTE_GH", name: "Ana" });
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
    findUnique.mockResolvedValue(null);
    const res = await userPATCH(jsonRequest({ name: "Ana" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si un no-Administrador intenta editar a un Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ADMINISTRADOR" });
    const res = await userPATCH(jsonRequest({ name: "Ana" }), ctx());
    expect(res.status).toBe(403);
  });

  it("un Administrador sí puede editar a otro Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ADMINISTRADOR" });
    update.mockResolvedValue({ id: "target-1", name: "Ana", email: "a@nexo.com", role: "ADMINISTRADOR", createdAt: new Date() });
    const res = await userPATCH(jsonRequest({ name: "Ana" }), ctx());
    expect(res.status).toBe(200);
  });

  it("responde 403 si alguien que no es Jefe Nacional ni Administrador intenta editar a un Jefe Nacional", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "JEFE_NACIONAL" });
    const res = await userPATCH(jsonRequest({ name: "Ana" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 400 ante un rol inválido", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ASISTENTE_GH" });
    const res = await userPATCH(jsonRequest({ role: "SUPERADMIN" }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 403 al intentar asignar un rol superior al del solicitante", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" }); // nivel 3
    findUnique.mockResolvedValue({ id: "target-1", role: "ASISTENTE_GH" });
    const res = await userPATCH(jsonRequest({ role: "JEFE_NACIONAL" }), ctx()); // nivel 4
    expect(res.status).toBe(403);
  });

  it("actualiza solo los campos provistos y recortados (trim)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ASISTENTE_GH" });
    update.mockResolvedValue({ id: "target-1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", createdAt: new Date() });

    await userPATCH(jsonRequest({ name: "  Ana  " }), ctx());
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Ana" } })
    );
  });

  it("responde 409 si el nuevo email colisiona con otro usuario (P2002)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ASISTENTE_GH" });
    update.mockRejectedValue({ code: "P2002" });
    const res = await userPATCH(jsonRequest({ email: "duplicado@nexo.com" }), ctx());
    expect(res.status).toBe(409);
  });

  it("relanza errores que no son P2002", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ASISTENTE_GH" });
    update.mockRejectedValue(new Error("boom"));
    await expect(userPATCH(jsonRequest({ name: "Ana" }), ctx())).rejects.toThrow("boom");
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
    mockSession({ role: "JEFE_NACIONAL", userId: "u1" });
    const res = await userDELETE(jsonRequest(), ctx("u1"));
    expect(res.status).toBe(400);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("responde 404 si el objetivo no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue(null);
    const res = await userDELETE(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 404 si el objetivo está fuera de la jerarquía visible (IDOR)", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    findUnique.mockResolvedValue({ role: "JEFE_NACIONAL" });
    const res = await userDELETE(jsonRequest(), ctx());
    expect(res.status).toBe(404);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("elimina al usuario cuando está dentro de la jerarquía visible", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ role: "ASISTENTE_GH" });
    deleteUser.mockResolvedValue({});
    const res = await userDELETE(jsonRequest(), ctx());
    expect(res.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith({ where: { id: "target-1" } });
  });

  it("responde 409 (no 500 crudo) si el usuario tiene registros asociados (violación de FK)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ role: "ASISTENTE_GH" });
    deleteUser.mockRejectedValue({ code: "P2003" });
    const res = await userDELETE(jsonRequest(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("registros asociados");
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
    findUnique.mockResolvedValue({ role: "JEFE_NACIONAL" });
    const res = await resetPasswordPOST(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("restablece la contraseña a un hash de '123456' y confirma en el mensaje con el nombre", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ASISTENTE_GH", name: "Ana" });
    update.mockResolvedValue({});

    const res = await resetPasswordPOST(jsonRequest(), ctx());
    expect(res.status).toBe(200);
    const call = update.mock.calls[0][0];
    expect(call.data.password).not.toBe("123456");
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
    findUnique.mockResolvedValue({ role: "JEFE_NACIONAL" });
    const res = await resetConsentPATCH(jsonRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("restablece el consentimiento a no aceptado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "target-1", role: "ASISTENTE_GH" });
    update.mockResolvedValue({});
    const res = await resetConsentPATCH(jsonRequest(), ctx());
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { dataConsentAccepted: false, dataConsentAcceptedAt: null },
    });
  });
});

describe("PATCH /api/users/[id]/theme", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si se intenta cambiar el tema de otro usuario", async () => {
    mockSession({ userId: "u1" });
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx("otro-usuario"));
    expect(res.status).toBe(403);
  });

  it("responde 400 ante un valor de tema inválido", async () => {
    mockSession({ userId: "u1" });
    const res = await themePATCH(jsonRequest({ theme: "PURPLE" }), ctx("u1"));
    expect(res.status).toBe(400);
  });

  it("actualiza el propio tema", async () => {
    mockSession({ userId: "u1" });
    update.mockResolvedValue({ theme: "DARK" });
    const res = await themePATCH(jsonRequest({ theme: "DARK" }), ctx("u1"));
    expect(res.status).toBe(200);
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

  it("actualiza las propias preferencias de vista", async () => {
    mockSession({ userId: "u1" });
    update.mockResolvedValue({ viewPreferences: ["kanban", "tabla"] });
    const res = await viewPreferencesPATCH(jsonRequest({ viewPreferences: ["kanban", "tabla"] }), ctx("u1"));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/users/assignable", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await assignableGET();
    expect(res.status).toBe(401);
  });

  it("filtra por los roles visibles del solicitante, ordenado por nombre", async () => {
    mockSession({ role: "ANALISTA_CC" });
    findMany.mockResolvedValue([]);
    await assignableGET();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { in: ["ANALISTA_CC", "ASISTENTE_GH", "TRABAJO_SOCIAL"] } },
        orderBy: { name: "asc" },
      })
    );
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

  it("un Administrador restablece el consentimiento de todos y recibe el conteo", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    updateMany.mockResolvedValue({ count: 42 });
    const res = await resetConsentAllPATCH();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, count: 42 });
  });
});
