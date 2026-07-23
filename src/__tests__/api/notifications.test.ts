import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const notificationFindMany = vi.fn();
const notificationCount = vi.fn();
const notificationUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { findMany: notificationFindMany, count: notificationCount, updateMany: notificationUpdateMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: notificationsGET, PATCH: notificationsPATCH } = await import("@/app/api/notifications/route");
const { PATCH: notificationPATCH } = await import("@/app/api/notifications/[id]/route");

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

function resetAll() {
  notificationFindMany.mockReset();
  notificationCount.mockReset();
  notificationUpdateMany.mockReset().mockResolvedValue({ count: 0 });
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
    expect(body).toEqual({ notifications: [{ id: "n1", taskAssignedToId: null }], unreadCount: 3 });
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
