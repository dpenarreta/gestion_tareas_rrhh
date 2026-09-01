import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Fases 3a/3b/3f de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): GET/POST /api/tasks/[id]/activities, PATCH/DELETE
// /api/tasks/[id]/activities/[activityId] y GET/POST
// /api/tasks/[id]/comments pasaron de Prisma a Django — este archivo
// mockeaba `@/lib/prisma` hasta esta actualización, probando lógica
// (migración de historial, límite de registros Fija, solapamiento de
// horarios, notificaciones jerárquicas) que ya NO vive en `route.ts`, se
// movió a `backend/apps/tasks/services.py` (ya cubierta ahí). Acá solo se
// cubre lo que el wrapper de Next.js realmente hace: sesión, mapeo de
// body/respuesta, forwarding a Django.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET: activitiesGET, POST: activitiesPOST } = await import("@/app/api/tasks/[id]/activities/route");
const { PATCH: activityPATCH, DELETE: activityDELETE } = await import("@/app/api/tasks/[id]/activities/[activityId]/route");
const { GET: commentsGET, POST: commentsPOST } = await import("@/app/api/tasks/[id]/comments/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          djangoUserId: 1,
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

function ctxActivity(id = "1", activityId = "1") {
  return { params: Promise.resolve({ id, activityId }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
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
    id: 1,
    task: 1,
    author: DJANGO_USER_REF,
    reason: "REUNION",
    start_time: null,
    end_time: null,
    duration: 90,
    description: "",
    is_retroactive: false,
    activity_date: null,
    admin_comment: null,
    modified_by_admin: false,
    modified_at: null,
    comment_count: 0,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function djangoComment(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 1, text: "hola", author: DJANGO_USER_REF, created_at: "2026-08-01T00:00:00Z", ...overrides };
}

describe("GET /api/tasks/[id]/activities", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await activitiesGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await activitiesGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde lista vacía (sin revelar si la tarea existe) si Django rechaza el acceso", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await activitiesGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("devuelve las actividades mapeadas a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [djangoActivity({ id: 7, duration: 45 })]));
    const res = await activitiesGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([expect.objectContaining({ id: "7", duration: 45, author: { id: "1", name: "Ana" } })]);
  });
});

describe("POST /api/tasks/[id]/activities", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await activitiesPOST(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION" }), ctx());
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si Django rechaza por permisos (tarea no visible)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION", hours: 1, minutes: 0 }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 400 con el mensaje de Django cuando la validación de negocio falla", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: { details: { non_field_errors: ["El horario se solapa"] } } }, 400)
    );
    const res = await activitiesPOST(jsonRequest({ reason: "REUNION", hours: 1, minutes: 0 }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("El horario se solapa");
  });

  it("mapea el body a snake_case y crea la actividad", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoActivity({ id: 9 }), 201));

    const res = await activitiesPOST(
      jsonRequest({ reason: "REUNION", hours: 1, minutes: 30, startTime: "09:00", endTime: "10:30" }),
      ctx("1")
    );
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/1/activities/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "REUNION", hours: 1, minutes: 30, description: "", start_time: "09:00", end_time: "10:30" }),
      })
    );
  });
});

describe("PATCH /api/tasks/[id]/activities/[activityId]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await activityPATCH(jsonRequest({}), ctxActivity());
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await activityPATCH(jsonRequest({}), ctxActivity());
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await activityPATCH(jsonRequest({ hours: 1, minutes: 0 }), ctxActivity());
    expect(res.status).toBe(403);
  });

  it("responde 404 si la actividad no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await activityPATCH(jsonRequest({ hours: 1, minutes: 0 }), ctxActivity());
    expect(res.status).toBe(404);
  });

  it("edita la actividad y devuelve la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoActivity({ duration: 60 })));
    const res = await activityPATCH(jsonRequest({ hours: 1, minutes: 0, comment: "corregido" }), ctxActivity("1", "3"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/1/activities/3/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ hours: 1, minutes: 0, comment: "corregido" }) })
    );
    expect((await res.json()).duration).toBe(60);
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
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien elimina no es el autor", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(403);
  });

  it("elimina la actividad propia", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, {}));
    const res = await activityDELETE(jsonRequest(undefined), ctxActivity());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/tasks/[id]/comments", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await commentsGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la tarea no es visible para el solicitante", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await commentsGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("devuelve los comentarios mapeados a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [djangoComment({ id: 5, text: "listo" })]));
    const res = await commentsGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([expect.objectContaining({ id: "5", text: "listo" })]);
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
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si la tarea no es visible para el solicitante", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await commentsPOST(jsonRequest({ text: "hola" }), ctx());
    expect(res.status).toBe(404);
  });

  it("crea el comentario recortado y devuelve 201 con la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoComment({ id: 9, text: "comentario" }), 201));

    const res = await commentsPOST(jsonRequest({ text: "  comentario  " }), ctx("1"));
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/1/comments/", expect.objectContaining({ body: JSON.stringify({ text: "comentario" }) }));
    expect((await res.json())).toMatchObject({ id: "9", text: "comentario" });
  });
});
