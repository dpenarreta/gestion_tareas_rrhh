import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const notificationFindMany = vi.fn();
const notificationCount = vi.fn();
const notificationUpdateMany = vi.fn();
const reminderFindMany = vi.fn();
const reminderFindUnique = vi.fn();
const reminderCreate = vi.fn();
const reminderUpdate = vi.fn();
const reminderDelete = vi.fn();
const taskFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { findMany: notificationFindMany, count: notificationCount, updateMany: notificationUpdateMany },
    followUpReminder: { findMany: reminderFindMany, findUnique: reminderFindUnique, create: reminderCreate, update: reminderUpdate, delete: reminderDelete },
    task: { findUnique: taskFindUnique },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: notificationsGET, PATCH: notificationsPATCH } = await import("@/app/api/notifications/route");
const { PATCH: notificationPATCH } = await import("@/app/api/notifications/[id]/route");
const { GET: remindersGET, POST: remindersPOST } = await import("@/app/api/reminders/route");
const { PATCH: reminderPATCH, DELETE: reminderDELETE } = await import("@/app/api/reminders/[id]/route");
const { GET: pendingGET } = await import("@/app/api/reminders/pending/route");

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

function ctx(id = "n1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function badJsonRequest() {
  return { json: async () => { throw new Error("bad"); } } as never;
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function resetAll() {
  notificationFindMany.mockReset();
  notificationCount.mockReset();
  notificationUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  reminderFindMany.mockReset();
  reminderFindUnique.mockReset();
  reminderCreate.mockReset();
  reminderUpdate.mockReset();
  reminderDelete.mockReset();
  taskFindUnique.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/notifications", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await notificationsGET();
    expect(res.status).toBe(401);
  });

  it("devuelve las últimas 20 notificaciones propias y el conteo de no leídas", async () => {
    mockSession({});
    notificationFindMany.mockResolvedValue([{ id: "n1" }]);
    notificationCount.mockResolvedValue(3);
    const res = await notificationsGET();
    expect(notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" }, take: 20 })
    );
    expect(notificationCount).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1", read: false } }));
    const body = await res.json();
    expect(body).toEqual({ notifications: [{ id: "n1" }], unreadCount: 3 });
  });
});

describe("PATCH /api/notifications", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await notificationsPATCH();
    expect(res.status).toBe(401);
  });

  it("marca como leídas todas las notificaciones no leídas del usuario", async () => {
    mockSession({});
    const res = await notificationsPATCH();
    expect(res.status).toBe(200);
    expect(notificationUpdateMany).toHaveBeenCalledWith({
      where: { userId: "u1", read: false },
      data: { read: true },
    });
  });
});

describe("PATCH /api/notifications/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await notificationPATCH(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("marca como leída solo si la notificación pertenece al usuario (scoped por where)", async () => {
    mockSession({ userId: "u1" });
    const res = await notificationPATCH(jsonRequest(undefined), ctx("n1"));
    expect(res.status).toBe(200);
    expect(notificationUpdateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "u1" },
      data: { read: true },
    });
  });
});

describe("GET /api/reminders", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await remindersGET(getRequest("http://localhost/api/reminders"));
    expect(res.status).toBe(401);
  });

  it("responde 400 si falta taskId", async () => {
    mockSession({});
    const res = await remindersGET(getRequest("http://localhost/api/reminders"));
    expect(res.status).toBe(400);
  });

  it("devuelve los recordatorios pendientes de la tarea, propios del usuario", async () => {
    mockSession({});
    reminderFindMany.mockResolvedValue([{ id: "r1" }]);
    const res = await remindersGET(getRequest("http://localhost/api/reminders?taskId=task-1"));
    expect(reminderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { taskId: "task-1", userId: "u1", completedAt: null } })
    );
    expect(res.status).toBe(200);
  });

  it("responde 500 ante un error inesperado", async () => {
    mockSession({});
    reminderFindMany.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await remindersGET(getRequest("http://localhost/api/reminders?taskId=task-1"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/reminders", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await remindersPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await remindersPOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await remindersPOST(jsonRequest({ taskId: "task-1" }));
    expect(res.status).toBe(400);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    taskFindUnique.mockResolvedValue(null);
    const res = await remindersPOST(jsonRequest({ taskId: "task-1", title: "Llamar", reminderAt: "2026-08-01T10:00:00Z" }));
    expect(res.status).toBe(404);
  });

  it("crea el recordatorio y responde 201", async () => {
    mockSession({ userId: "u1" });
    taskFindUnique.mockResolvedValue({ id: "task-1" });
    reminderCreate.mockResolvedValue({ id: "r1" });
    const res = await remindersPOST(jsonRequest({ taskId: "task-1", title: "  Llamar  ", reminderAt: "2026-08-01T10:00:00Z" }));
    expect(res.status).toBe(201);
    expect(reminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u1", title: "Llamar" }) })
    );
  });

  it("responde 500 ante un error inesperado", async () => {
    mockSession({});
    taskFindUnique.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await remindersPOST(jsonRequest({ taskId: "task-1", title: "x", reminderAt: "2026-08-01T10:00:00Z" }));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/reminders/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await reminderPATCH(jsonRequest({}), ctx("r1"));
    expect(res.status).toBe(401);
  });

  it("responde 404 si el recordatorio no existe", async () => {
    mockSession({});
    reminderFindUnique.mockResolvedValue(null);
    const res = await reminderPATCH(jsonRequest({}), ctx("r1"));
    expect(res.status).toBe(404);
  });

  it("responde 404 si el recordatorio pertenece a otro usuario", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "otro" });
    const res = await reminderPATCH(jsonRequest({}), ctx("r1"));
    expect(res.status).toBe(404);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    const res = await reminderPATCH(badJsonRequest(), ctx("r1"));
    expect(res.status).toBe(400);
  });

  it("responde 400 si el título se envía vacío", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    const res = await reminderPATCH(jsonRequest({ title: "   " }), ctx("r1"));
    expect(res.status).toBe(400);
  });

  it("marcar completed=true establece completedAt", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    reminderUpdate.mockResolvedValue({});
    await reminderPATCH(jsonRequest({ completed: true }), ctx("r1"));
    expect(reminderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completedAt: expect.any(Date) } })
    );
  });

  it("marcar completed=false limpia completedAt", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    reminderUpdate.mockResolvedValue({});
    await reminderPATCH(jsonRequest({ completed: false }), ctx("r1"));
    expect(reminderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { completedAt: null } }));
  });

  it("reprogramar (reminderAt) limpia snoozedUntil y completedAt", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    reminderUpdate.mockResolvedValue({});
    await reminderPATCH(jsonRequest({ reminderAt: "2026-09-01T10:00:00Z" }), ctx("r1"));
    expect(reminderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { reminderAt: new Date("2026-09-01T10:00:00Z"), snoozedUntil: null, completedAt: null },
      })
    );
  });

  it("posponer (snoozedUntil) solo actualiza ese campo", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    reminderUpdate.mockResolvedValue({});
    await reminderPATCH(jsonRequest({ snoozedUntil: "2026-08-05T10:00:00Z" }), ctx("r1"));
    expect(reminderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { snoozedUntil: new Date("2026-08-05T10:00:00Z") } })
    );
  });

  it("responde 500 ante un error inesperado", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await reminderPATCH(jsonRequest({ completed: true }), ctx("r1"));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/reminders/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await reminderDELETE(jsonRequest(undefined), ctx("r1"));
    expect(res.status).toBe(401);
  });

  it("responde 404 si no existe o pertenece a otro usuario", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "otro" });
    const res = await reminderDELETE(jsonRequest(undefined), ctx("r1"));
    expect(res.status).toBe(404);
    expect(reminderDelete).not.toHaveBeenCalled();
  });

  it("elimina el recordatorio propio", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    reminderDelete.mockResolvedValue({});
    const res = await reminderDELETE(jsonRequest(undefined), ctx("r1"));
    expect(res.status).toBe(200);
  });

  it("responde 500 ante un error inesperado", async () => {
    mockSession({ userId: "u1" });
    reminderFindUnique.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await reminderDELETE(jsonRequest(undefined), ctx("r1"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/reminders/pending", () => {
  beforeEach(resetAll);
  afterEach(() => vi.useRealTimers());

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await pendingGET();
    expect(res.status).toBe(401);
  });

  it("consulta recordatorios vencidos y no completados, con snooze ya expirado o ausente", async () => {
    mockSession({});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    reminderFindMany.mockResolvedValue([]);
    await pendingGET();
    expect(reminderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "u1",
          completedAt: null,
          reminderAt: { lte: new Date("2026-08-01T12:00:00Z") },
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date("2026-08-01T12:00:00Z") } }],
        },
      })
    );
  });

  it("ante un error inesperado, responde 200 con lista vacía en vez de fallar", async () => {
    mockSession({});
    reminderFindMany.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await pendingGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
