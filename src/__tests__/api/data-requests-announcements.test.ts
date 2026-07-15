import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const dataSubjectRequestFindMany = vi.fn();
const dataSubjectRequestFindUnique = vi.fn();
const dataSubjectRequestCreate = vi.fn();
const dataSubjectRequestUpdate = vi.fn();
const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const taskFindMany = vi.fn();
const taskActivityFindMany = vi.fn();
const commentFindMany = vi.fn();
const meetingFindMany = vi.fn();
const meetingInviteeFindMany = vi.fn();
const improvementIdeaFindMany = vi.fn();
const ideaVoteFindMany = vi.fn();
const notificationCreateMany = vi.fn();
const announcementFindMany = vi.fn();
const announcementCreate = vi.fn();
const announcementDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dataSubjectRequest: {
      findMany: dataSubjectRequestFindMany,
      findUnique: dataSubjectRequestFindUnique,
      create: dataSubjectRequestCreate,
      update: dataSubjectRequestUpdate,
    },
    user: { findMany: userFindMany, findUnique: userFindUnique },
    task: { findMany: taskFindMany },
    taskActivity: { findMany: taskActivityFindMany },
    comment: { findMany: commentFindMany },
    meeting: { findMany: meetingFindMany },
    meetingInvitee: { findMany: meetingInviteeFindMany },
    improvementIdea: { findMany: improvementIdeaFindMany },
    ideaVote: { findMany: ideaVoteFindMany },
    notification: { createMany: notificationCreateMany },
    announcement: { findMany: announcementFindMany, create: announcementCreate, delete: announcementDelete },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: requestsGET, POST: requestsPOST } = await import("@/app/api/data-requests/route");
const { PATCH: requestPATCH } = await import("@/app/api/data-requests/[id]/route");
const { GET: myDataGET } = await import("@/app/api/data-requests/my-data/route");
const { GET: announcementsGET, POST: announcementsPOST } = await import("@/app/api/announcements/route");
const { DELETE: announcementDELETE } = await import("@/app/api/announcements/[id]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Ana",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function ctx(id = "req-1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function badJsonRequest() {
  return { json: async () => { throw new Error("bad"); } } as never;
}

function resetAll() {
  dataSubjectRequestFindMany.mockReset();
  dataSubjectRequestFindUnique.mockReset();
  dataSubjectRequestCreate.mockReset().mockResolvedValue({});
  dataSubjectRequestUpdate.mockReset();
  userFindMany.mockReset();
  userFindUnique.mockReset();
  taskFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  commentFindMany.mockReset().mockResolvedValue([]);
  meetingFindMany.mockReset().mockResolvedValue([]);
  meetingInviteeFindMany.mockReset().mockResolvedValue([]);
  improvementIdeaFindMany.mockReset().mockResolvedValue([]);
  ideaVoteFindMany.mockReset().mockResolvedValue([]);
  notificationCreateMany.mockReset().mockResolvedValue({});
  announcementFindMany.mockReset();
  announcementCreate.mockReset();
  announcementDelete.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/data-requests", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await requestsGET();
    expect(res.status).toBe(401);
  });

  it("un Administrador ve todas las solicitudes (sin filtro)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    dataSubjectRequestFindMany.mockResolvedValue([]);
    await requestsGET();
    expect(dataSubjectRequestFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });

  it("un usuario normal solo ve sus propias solicitudes", async () => {
    mockSession({ role: "ASISTENTE_GH", userId: "u1" });
    dataSubjectRequestFindMany.mockResolvedValue([]);
    await requestsGET();
    expect(dataSubjectRequestFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" } }));
  });
});

describe("POST /api/data-requests", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await requestsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await requestsPOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 ante un tipo de solicitud inválido", async () => {
    mockSession({});
    const res = await requestsPOST(jsonRequest({ type: "OTRO" }));
    expect(res.status).toBe(400);
  });

  it("una solicitud de tipo ACCESO no notifica a los administradores", async () => {
    mockSession({});
    await requestsPOST(jsonRequest({ type: "ACCESO" }));
    expect(userFindMany).not.toHaveBeenCalled();
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });

  it("una solicitud de RECTIFICACION notifica a los administradores existentes", async () => {
    mockSession({ name: "Ana" });
    userFindMany.mockResolvedValue([{ id: "admin-1" }]);
    const res = await requestsPOST(jsonRequest({ type: "RECTIFICACION", description: "Cambiar mi nombre" }));
    expect(res.status).toBe(201);
    expect(notificationCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: "admin-1", message: expect.stringContaining("rectificación") })],
    });
  });

  it("no notifica si no hay administradores registrados", async () => {
    mockSession({});
    userFindMany.mockResolvedValue([]);
    await requestsPOST(jsonRequest({ type: "ELIMINACION" }));
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/data-requests/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await requestPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si quien resuelve no es Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await requestPATCH(jsonRequest({ status: "RESUELTA" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await requestPATCH(badJsonRequest(), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 ante un estado inválido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await requestPATCH(jsonRequest({ status: "CANCELADA" }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 404 si la solicitud no existe", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    dataSubjectRequestFindUnique.mockResolvedValue(null);
    const res = await requestPATCH(jsonRequest({ status: "EN_PROCESO" }), ctx());
    expect(res.status).toBe(404);
  });

  it("marcar RESUELTA registra quién y cuándo la resolvió", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    dataSubjectRequestFindUnique.mockResolvedValue({ id: "req-1" });
    dataSubjectRequestUpdate.mockResolvedValue({});
    await requestPATCH(jsonRequest({ status: "RESUELTA" }), ctx());
    expect(dataSubjectRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "RESUELTA", resolvedBy: "admin-1", resolvedAt: expect.any(Date) },
      })
    );
  });

  it("un estado no resuelto limpia resolvedBy/resolvedAt", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    dataSubjectRequestFindUnique.mockResolvedValue({ id: "req-1" });
    dataSubjectRequestUpdate.mockResolvedValue({});
    await requestPATCH(jsonRequest({ status: "EN_PROCESO" }), ctx());
    expect(dataSubjectRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EN_PROCESO", resolvedBy: null, resolvedAt: null } })
    );
  });
});

describe("GET /api/data-requests/my-data", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await myDataGET();
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario ya no existe", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue(null);
    const res = await myDataGET();
    expect(res.status).toBe(404);
  });

  it("registra un ACCESO resuelto y devuelve un JSON descargable con todos los datos del usuario", async () => {
    mockSession({ userId: "u1" });
    userFindUnique.mockResolvedValue({ id: "u1", name: "Ana" });
    taskFindMany.mockResolvedValue([{ id: "t1" }]);

    const res = await myDataGET();
    expect(res.status).toBe(200);
    expect(dataSubjectRequestCreate).toHaveBeenCalledWith({
      data: { userId: "u1", type: "ACCESO", status: "RESUELTA", resolvedAt: expect.any(Date) },
    });
    expect(res.headers.get("Content-Disposition")).toContain("nexo-mis-datos-u1.json");

    const body = JSON.parse(await res.text());
    expect(body.usuario).toEqual({ id: "u1", name: "Ana" });
    expect(body.tareas).toEqual([{ id: "t1" }]);
  });
});

describe("GET /api/announcements", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await announcementsGET();
    expect(res.status).toBe(401);
  });

  it("filtra comunicados vigentes, fijados primero", async () => {
    mockSession({});
    announcementFindMany.mockResolvedValue([]);
    await announcementsGET();
    expect(announcementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expiresAt: { gt: expect.any(Date) } },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      })
    );
  });
});

describe("POST /api/announcements", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await announcementsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de publicación", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await announcementsPOST(jsonRequest({}));
    expect(res.status).toBe(403);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await announcementsPOST(jsonRequest({ title: "Aviso" }));
    expect(res.status).toBe(400);
  });

  it("recorta la duración a un mínimo de 1 día", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    announcementCreate.mockResolvedValue({ id: "a1", title: "Aviso" });
    userFindMany.mockResolvedValue([]);
    await announcementsPOST(jsonRequest({ title: "Aviso", content: "Contenido", durationDays: -5 }));
    const call = announcementCreate.mock.calls[0][0];
    const expiresAt: Date = call.data.expiresAt;
    const daysDiff = Math.round((expiresAt.getTime() - Date.now()) / 86400000);
    expect(daysDiff).toBe(1);
  });

  it("recorta la duración a un máximo de 30 días", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    announcementCreate.mockResolvedValue({ id: "a1", title: "Aviso" });
    userFindMany.mockResolvedValue([]);
    await announcementsPOST(jsonRequest({ title: "Aviso", content: "Contenido", durationDays: 365 }));
    const call = announcementCreate.mock.calls[0][0];
    const expiresAt: Date = call.data.expiresAt;
    const daysDiff = Math.round((expiresAt.getTime() - Date.now()) / 86400000);
    expect(daysDiff).toBe(30);
  });

  it("notifica a los usuarios visibles, excluyendo al propio autor", async () => {
    mockSession({ userId: "u1", role: "ADMINISTRADOR" });
    announcementCreate.mockResolvedValue({ id: "a1", title: "Aviso importante" });
    userFindMany.mockResolvedValue([{ id: "target-1" }]);

    const res = await announcementsPOST(jsonRequest({ title: "Aviso importante", content: "Contenido", durationDays: 7 }));
    expect(res.status).toBe(201);
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: "u1" } }) })
    );
    expect(notificationCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: "target-1", message: expect.stringContaining("Aviso importante") })],
    });
  });

  it("no notifica si no hay usuarios visibles", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    announcementCreate.mockResolvedValue({ id: "a1", title: "Aviso" });
    userFindMany.mockResolvedValue([]);
    await announcementsPOST(jsonRequest({ title: "Aviso", content: "Contenido", durationDays: 7 }));
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/announcements/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await announcementDELETE(jsonRequest(undefined), ctx("a1"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de eliminación", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await announcementDELETE(jsonRequest(undefined), ctx("a1"));
    expect(res.status).toBe(403);
  });

  it("elimina el comunicado para un rol autorizado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    announcementDelete.mockResolvedValue({});
    const res = await announcementDELETE(jsonRequest(undefined), ctx("a1"));
    expect(res.status).toBe(200);
    expect(announcementDelete).toHaveBeenCalledWith({ where: { id: "a1" } });
  });
});
