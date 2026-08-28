import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Sub-fase 3f de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): POST /api/tasks/[id]/activities/retroactive pasó de Prisma
// a Django (mockeado acá con `@/lib/djangoSession`) — la validación de
// solapamiento/hora inicio-fin ya no vive en `route.ts`. GET
// /api/activities/day-schedule también se cortó a Django en el cutover de
// stack (ver docs/AUDIT_LOG.md § 2026-08-21) — mismas Actividades que este
// endpoint valida ya se escriben solo en Django.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { POST: retroactivePOST } = await import("@/app/api/tasks/[id]/activities/retroactive/route");
const { GET: dayScheduleGET } = await import("@/app/api/activities/day-schedule/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
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

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function getRequest(url: string) {
  return { nextUrl: new URL(url) } as never;
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const DJANGO_USER_REF = { id: 1, username: "ana", first_name: "Ana", email: "ana@nexo.com", roles: [{ id: 1, name: "ASISTENTE_GH" }] };

function djangoActivity(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, task: 1, author: DJANGO_USER_REF, reason: "REUNION", start_time: "09:00", end_time: "10:00",
    duration: 60, description: "Descripción obligatoria", is_retroactive: true, activity_date: "2026-07-14T00:00:00Z",
    admin_comment: null, modified_by_admin: false, modified_at: null, comment_count: 0, created_at: "2026-07-14T00:00:00Z",
    ...overrides,
  };
}

const VALID_RETROACTIVE_DATE = "2026-07-14";

describe("POST /api/tasks/[id]/activities/retroactive", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await retroactivePOST(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await retroactivePOST(jsonRequest({ reason: "REUNION" }), ctx());
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si Django rechaza por permisos (tarea no visible)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await retroactivePOST(
      jsonRequest({ reason: "REUNION", hours: 1, minutes: 0, description: "d", activityDate: VALID_RETROACTIVE_DATE }),
      ctx()
    );
    expect(res.status).toBe(404);
  });

  it("responde 400 con el mensaje de Django ante solapamiento u otra validación de negocio", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: { details: { non_field_errors: ["El horario se solapa"] } } }, 400)
    );
    const res = await retroactivePOST(
      jsonRequest({
        reason: "REUNION", hours: 0, minutes: 45, description: "d", activityDate: VALID_RETROACTIVE_DATE,
        startTime: "09:00", endTime: "09:45",
      }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("El horario se solapa");
  });

  it("mapea el body a snake_case (activityDate->activity_date) y crea la actividad retroactiva", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoActivity(), 201));

    const res = await retroactivePOST(
      jsonRequest({
        reason: "REUNION", hours: 1, minutes: 0, description: "Descripción obligatoria",
        activityDate: VALID_RETROACTIVE_DATE, startTime: "09:00", endTime: "10:00",
      }),
      ctx("1")
    );
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/1/activities/retroactive/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "REUNION", hours: 1, minutes: 0, description: "Descripción obligatoria",
          activity_date: VALID_RETROACTIVE_DATE, start_time: "09:00", end_time: "10:00",
        }),
      })
    );
    expect((await res.json())).toMatchObject({ startTime: "09:00", endTime: "10:00" });
  });
});

describe("GET /api/activities/day-schedule", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await dayScheduleGET(getRequest("http://localhost/api/activities/day-schedule"));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await dayScheduleGET(getRequest("http://localhost/api/activities/day-schedule"));
    expect(res.status).toBe(401);
  });

  it("responde 400 si la fecha tiene formato inválido", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Fecha inválida" }, 400));
    const res = await dayScheduleGET(getRequest("http://localhost/api/activities/day-schedule?date=15-07-2026"));
    expect(res.status).toBe(400);
  });

  it("reenvía el parámetro date y devuelve las actividades tal cual las da Django", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, [{ id: 1, startTime: "08:00", endTime: "09:00", taskId: 1, taskTitle: "Tarea A" }])
    );
    const res = await dayScheduleGET(getRequest("http://localhost/api/activities/day-schedule?date=2026-07-14"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 1, startTime: "08:00", endTime: "09:00", taskId: 1, taskTitle: "Tarea A" }]);
    expect(djangoApiFetch).toHaveBeenCalledWith("/activities/day-schedule/?date=2026-07-14");
  });

  it("sin date, no agrega el parámetro a la URL", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, []));
    await dayScheduleGET(getRequest("http://localhost/api/activities/day-schedule"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/activities/day-schedule/");
  });
});
