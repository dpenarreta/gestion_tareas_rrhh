import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): `Notification` ya
// la escriben internamente Tareas/Proyectos/Escritorio Digital/Reuniones/
// Ideas/LOPD desde que cada uno se portó a Django — esta campana leía
// Postgres, así que nunca veía ninguna de esas notificaciones. Mockeado con
// `@/lib/djangoSession`, mismo patrón que el resto de este cutover.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const djangoApiFetch = vi.fn();
class DjangoUnavailableError extends Error {}
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  DjangoUnavailableError,
}));

const { getSession } = await import("@/lib/session");
const { GET: notificationsGET, PATCH: notificationsPATCH } = await import("@/app/api/notifications/route");
const { PATCH: notificationPATCH } = await import("@/app/api/notifications/[id]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          djangoUserId: 1,
          permissions: [],
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

  it("503 con JSON si Django no responde (la campana no rompe)", async () => {
    mockSession({});
    djangoApiFetch.mockRejectedValue(new DjangoUnavailableError("down"));
    const res = await notificationsGET();
    expect(res.status).toBe(503);
  });

  it("un error 5xx de Django no se presenta como sesión vencida", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 500));
    const res = await notificationsGET();
    expect(res.status).toBe(500);
  });

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
          {
            id: 2,
            user_id: 7,
            message: "Registro de horas extras eliminado",
            task_id: null,
            task_title: null,
            read: false,
            category: "deletion",
            created_at: "2026-08-21T12:05:00Z",
            task_assigned_to_id: null,
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
          category: "",
          createdAt: "2026-08-21T12:00:00Z",
          taskAssignedToId: "7",
        },
        {
          id: "2",
          userId: "7",
          message: "Registro de horas extras eliminado",
          taskId: null,
          taskTitle: null,
          read: false,
          category: "deletion",
          createdAt: "2026-08-21T12:05:00Z",
          taskAssignedToId: null,
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
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await notificationPATCH(jsonRequest(undefined), ctx("1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/notifications/1/", { method: "PATCH" });
  });
});
