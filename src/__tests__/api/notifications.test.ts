import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): `Notification` ya
// la escriben internamente Tareas/Proyectos/Escritorio Digital/Reuniones/
// Ideas/LOPD desde que cada uno se portó a Django — esta campana leía
// Postgres, así que nunca veía ninguna de esas notificaciones. Mockeado con
// `@/lib/djangoSession`, mismo patrón que el resto de este cutover.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

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

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function resetAll() {
  vi.mocked(getSession).mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/notifications", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await notificationsGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await notificationsGET();
    expect(res.status).toBe(401);
  });

  it("mapea las notificaciones y el conteo de no leídas a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        notifications: [
          {
            id: 1,
            user_id: 7,
            message: "Te asignaron una tarea",
            task_id: 42,
            task_title: "Tarea X",
            read: false,
            created_at: "2026-08-21T12:00:00Z",
            task_assigned_to_id: 7,
          },
        ],
        unread_count: 3,
      })
    );
    const res = await notificationsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      notifications: [
        {
          id: "1",
          userId: "7",
          message: "Te asignaron una tarea",
          taskId: "42",
          taskTitle: "Tarea X",
          read: false,
          createdAt: "2026-08-21T12:00:00Z",
          taskAssignedToId: "7",
        },
      ],
      unreadCount: 3,
    });
    expect(djangoApiFetch).toHaveBeenCalledWith("/notifications/");
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
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await notificationsPATCH();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/notifications/", { method: "PATCH" });
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("PATCH /api/notifications/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await notificationPATCH(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("marca como leída la notificación (scoped por usuario del lado de Django)", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await notificationPATCH(jsonRequest(undefined), ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/notifications/1/", { method: "PATCH" });
  });
});
