import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const taskActivityFindMany = vi.fn();
const taskActivityFindUnique = vi.fn();
const taskActivityCreate = vi.fn();
const taskActivityDelete = vi.fn();
const taskFindUnique = vi.fn();
const taskUpdate = vi.fn();
const commentFindMany = vi.fn();
const commentCreate = vi.fn();
const commentCount = vi.fn();
const taskCommentViewUpsert = vi.fn();
const notificationCreateMany = vi.fn();
const userFindMany = vi.fn();
const activityReasonFindUnique = vi.fn();
const systemConfigHistoryFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    taskActivity: { findMany: taskActivityFindMany, findUnique: taskActivityFindUnique, create: taskActivityCreate, delete: taskActivityDelete },
    task: { findUnique: taskFindUnique, update: taskUpdate },
    comment: { findMany: commentFindMany, create: commentCreate, count: commentCount },
    taskCommentView: { upsert: taskCommentViewUpsert },
    notification: { createMany: notificationCreateMany },
    user: { findMany: userFindMany },
    activityReason: { findUnique: activityReasonFindUnique },
    systemConfigHistory: { findFirst: systemConfigHistoryFindFirst },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: activitiesGET, POST: activitiesPOST } = await import("@/app/api/tasks/[id]/activities/route");
const { DELETE: activityDELETE } = await import("@/app/api/tasks/[id]/activities/[activityId]/route");
const { GET: commentsGET, POST: commentsPOST } = await import("@/app/api/tasks/[id]/comments/route");

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

function ctx(id = "task-1") {
  return { params: Promise.resolve({ id }) };
}

function ctxActivity(id = "task-1", activityId = "activity-1") {
  return { params: Promise.resolve({ id, activityId }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function badJsonRequest() {
  return {
    json: async () => {
      throw new Error("bad json");
    },
  } as never;
}

function resetAll() {
  taskActivityFindMany.mockReset();
  taskActivityFindUnique.mockReset();
  taskActivityCreate.mockReset();
  taskActivityDelete.mockReset();
  taskFindUnique.mockReset();
  taskUpdate.mockReset().mockResolvedValue({});
  commentFindMany.mockReset();
  commentCreate.mockReset();
  taskCommentViewUpsert.mockReset().mockResolvedValue({});
  notificationCreateMany.mockReset().mockResolvedValue({});
  userFindMany.mockReset();
  activityReasonFindUnique.mockReset().mockResolvedValue({
    key: "REUNION",
    isActive: true,
    assignedRoles: ["ASISTENTE_GH", "JEFE_NACIONAL"],
  });
  commentCount.mockReset().mockResolvedValue(1);
  systemConfigHistoryFindFirst.mockReset().mockResolvedValue(null);
  vi.mocked(getSession).mockReset();
}

describe("GET /api/tasks/[id]/activities", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await activitiesGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("devuelve las actividades ordenadas ascendentemente", async () => {
    mockSession({});
    taskActivityFindMany.mockResolvedValue([{ id: "a1" }]);
    const res = await activitiesGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(taskActivityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { taskId: "task-1" }, orderBy: { createdAt: "asc" } })
    );
  });

  it("ante un error inesperado, responde 200 con lista vacía en vez de propagar el error", async () => {
    mockSession({});
    taskActivityFindMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await activitiesGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("POST /api/tasks/[id]/activities", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await activitiesPOST(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await activitiesPOST(badJsonRequest(), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION" }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si las horas están fuera de [0,23]", async () => {
    mockSession({});
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION", hours: 24, minutes: 0 }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si los minutos están fuera de [0,59]", async () => {
    mockSession({});
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION", hours: 1, minutes: 60 }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si la duración total es 0", async () => {
    mockSession({});
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION", hours: 0, minutes: 0 }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    taskFindUnique.mockResolvedValue(null);
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION", hours: 1, minutes: 30 }), ctx());
    expect(res.status).toBe(404);
  });

  it("crea la actividad y recalcula realHours de la tarea a partir de la suma de duraciones", async () => {
    mockSession({ userId: "u1" });
    taskFindUnique.mockResolvedValue({ id: "task-1" });
    taskActivityCreate.mockResolvedValue({ id: "a1", duration: 90 });
    taskActivityFindMany.mockResolvedValue([{ duration: 90 }, { duration: 30 }]);

    const res = await activitiesPOST(jsonRequest({ reason: "REUNION", hours: 1, minutes: 30 }), ctx());
    expect(res.status).toBe(201);
    expect(taskActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ duration: 90, authorId: "u1" }) })
    );
    // (90+30)/60 = 2 horas
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { realHours: 2 } });
  });

  it("ante un error inesperado, responde 500", async () => {
    mockSession({});
    taskFindUnique.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION", hours: 1, minutes: 0 }), ctx());
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/tasks/[id]/activities/[activityId]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la actividad no existe", async () => {
    mockSession({});
    taskActivityFindUnique.mockResolvedValue(null);
    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(404);
  });

  it("responde 404 si la actividad pertenece a otra tarea", async () => {
    mockSession({});
    taskActivityFindUnique.mockResolvedValue({ id: "activity-1", taskId: "otra-tarea", authorId: "u1" });
    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien elimina no es el autor de la actividad", async () => {
    mockSession({ userId: "u1" });
    taskActivityFindUnique.mockResolvedValue({ id: "activity-1", taskId: "task-1", authorId: "otro-autor" });
    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(403);
    expect(taskActivityDelete).not.toHaveBeenCalled();
  });

  it("elimina la actividad propia y recalcula realHours", async () => {
    mockSession({ userId: "u1" });
    taskActivityFindUnique.mockResolvedValue({ id: "activity-1", taskId: "task-1", authorId: "u1" });
    taskActivityDelete.mockResolvedValue({});
    taskActivityFindMany.mockResolvedValue([{ duration: 45 }]);

    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { realHours: 0.75 } });
  });

  it("ante un error inesperado, responde 500", async () => {
    mockSession({});
    taskActivityFindUnique.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(500);
  });
});

describe("GET /api/tasks/[id]/comments", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await commentsGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("devuelve los comentarios y marca la tarea como vista (upsert)", async () => {
    mockSession({ userId: "u1" });
    commentFindMany.mockResolvedValue([{ id: "c1" }]);
    const res = await commentsGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(taskCommentViewUpsert).toHaveBeenCalledWith({
      where: { taskId_userId: { taskId: "task-1", userId: "u1" } },
      update: { viewedAt: expect.any(Date) },
      create: { taskId: "task-1", userId: "u1" },
    });
  });
});

describe("POST /api/tasks/[id]/comments", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await commentsPOST(jsonRequest({ text: "hola" }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 400 si el texto está vacío o son solo espacios", async () => {
    mockSession({});
    expect((await commentsPOST(jsonRequest({ text: "   " }), ctx())).status).toBe(400);
    expect((await commentsPOST(jsonRequest({}), ctx())).status).toBe(400);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    taskFindUnique.mockResolvedValue(null);
    const res = await commentsPOST(jsonRequest({ text: "hola" }), ctx());
    expect(res.status).toBe(404);
  });

  it("no notifica a nadie si el rol no tiene objetivos de notificación (ej. JEFE_NACIONAL)", async () => {
    mockSession({ role: "JEFE_NACIONAL", name: "Jefe" });
    taskFindUnique.mockResolvedValue({ id: "task-1", title: "Tarea" });
    commentCreate.mockResolvedValue({ id: "c1" });

    await commentsPOST(jsonRequest({ text: "comentario" }), ctx());
    expect(userFindMany).not.toHaveBeenCalled();
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });

  it("notifica a los roles objetivo (hacia arriba en la jerarquía), con el texto recortado a 60 caracteres", async () => {
    mockSession({ role: "ASISTENTE_GH", name: "Ana" });
    taskFindUnique.mockResolvedValue({ id: "task-1", title: "Tarea importante" });
    commentCreate.mockResolvedValue({ id: "c1" });
    userFindMany.mockResolvedValue([{ id: "analista-1" }, { id: "analista-2" }]);

    const longText = "x".repeat(80);
    await commentsPOST(jsonRequest({ text: longText }), ctx());

    expect(notificationCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: "analista-1", taskId: "task-1" }),
        expect.objectContaining({ userId: "analista-2", taskId: "task-1" }),
      ],
    });
    const message: string = notificationCreateMany.mock.calls[0][0].data[0].message;
    expect(message).toContain("x".repeat(60) + "…");
    expect(message).not.toContain("x".repeat(61));
  });

  it("no crea notificaciones si no hay usuarios con los roles objetivo", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    taskFindUnique.mockResolvedValue({ id: "task-1", title: "Tarea" });
    commentCreate.mockResolvedValue({ id: "c1" });
    userFindMany.mockResolvedValue([]);

    await commentsPOST(jsonRequest({ text: "hola" }), ctx());
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });
});
