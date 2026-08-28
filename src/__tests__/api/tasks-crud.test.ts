import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Fase 3a de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// GET/POST /api/tasks y PATCH/DELETE /api/tasks/[id] pasaron de Prisma a
// Django — este archivo mockeaba `@/lib/prisma` hasta esta actualización,
// probando lógica (permisos, cálculo de progress/completedAt, reset de
// aprobación de Fecha Fin) que ya NO vive en `route.ts`, se movió a
// `backend/apps/tasks/services.py` (ya cubierta ahí, ver
// `backend/apps/tasks/tests/test_tasks.py`). Acá solo se cubre lo que el
// wrapper de Next.js realmente hace: sesión, mapeo de body/respuesta,
// forwarding a Django — mismo criterio que `auth.test.ts` tras su propio
// cutover (Fase 6a-6c).
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET: tasksGET, POST: tasksPOST } = await import("@/app/api/tasks/route");
const { PATCH: taskPATCH, DELETE: taskDELETE } = await import("@/app/api/tasks/[id]/route");

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

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body, headers: new Headers() } as never;
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const DJANGO_USER_REF = { id: 5, username: "otro", first_name: "Otro", email: "otro@nexo.com", roles: [{ id: 1, name: "ASISTENTE_GH" }] };

function djangoTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: "Tarea",
    description: "",
    type: "FIJA",
    status: "PENDIENTE",
    priority: "MEDIA",
    frequency: "PUNTUAL",
    start_date: "2026-08-01T00:00:00Z",
    end_date: "2026-08-05T00:00:00Z",
    estimated_hours: 4,
    real_hours: 0,
    target_time_validated: null,
    progress: 0,
    color: "",
    corrected: false,
    assigned_to: DJANGO_USER_REF,
    created_by: DJANGO_USER_REF,
    comment_count: 0,
    has_unread_comments: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("GET /api/tasks", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await tasksGET();
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await tasksGET();
    expect(res.status).toBe(401);
  });

  it("responde 200 con las tareas mapeadas a la forma Nexo (camelCase)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [djangoTask({ id: 7, title: "Propia" })]));

    const res = await tasksGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: "7", title: "Propia", assignedTo: { id: "5", name: "Otro" } });
  });
});

describe("POST /api/tasks", () => {
  beforeEach(resetAll);

  const validBody = {
    title: "Nueva tarea",
    priority: "ALTA",
    frequency: "PUNTUAL",
    startDate: "2026-08-01",
    endDate: "2026-08-05",
    estimatedHours: "4",
    assignedToId: "5",
  };

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await tasksPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await tasksPOST(jsonRequest({ title: "Tarea" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await tasksPOST(jsonRequest(validBody));
    expect(res.status).toBe(401);
  });

  it("responde 400 si Django rechaza la creación", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "x" }));
    const res = await tasksPOST(jsonRequest(validBody));
    expect(res.status).toBe(400);
  });

  it("mapea el body a snake_case y aplica los defaults de type/status", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoTask({ id: 9 }), 201));

    await tasksPOST(jsonRequest(validBody));

    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Nueva tarea",
          description: "",
          priority: "ALTA",
          frequency: "PUNTUAL",
          type: "FIJA",
          status: "PENDIENTE",
          start_date: "2026-08-01",
          end_date: "2026-08-05",
          estimated_hours: "4",
          assigned_to: 5,
        }),
      })
    );
  });

  it("responde 201 con la tarea creada mapeada a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, djangoTask({ id: 9, title: "Nueva tarea" }), 201));

    const res = await tasksPOST(jsonRequest(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: "9", title: "Nueva tarea" });
  });
});

describe("PATCH /api/tasks/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await taskPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible al buscar la tarea", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await taskPATCH(jsonRequest({ title: "x" }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, {}, 404));
    const res = await taskPATCH(jsonRequest({ title: "x" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si la tarea está archivada", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask({ archived_month: "2026-01" })));
    const res = await taskPATCH(jsonRequest({ title: "x" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 403 si Django rechaza la edición por permisos", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, {}, 403));

    const res = await taskPATCH(jsonRequest({ status: "COMPLETADA" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 400 si Django rechaza la edición por otro motivo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, {}, 400));

    const res = await taskPATCH(jsonRequest({ realHours: 5 }), ctx());
    expect(res.status).toBe(400);
  });

  it("solo reenvía a Django los campos presentes en el body, mapeados a snake_case", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask({ id: 1 })));

    await taskPATCH(jsonRequest({ status: "COMPLETADA", realHours: 5.128 }), ctx("1"));

    expect(djangoApiFetch).toHaveBeenLastCalledWith(
      "/tasks/1/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "COMPLETADA", real_hours: 5.128 }) })
    );
  });

  it("mapea assignedToId a assigned_to numérico", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));

    await taskPATCH(jsonRequest({ assignedToId: "8" }), ctx("1"));

    expect(djangoApiFetch).toHaveBeenLastCalledWith(
      "/tasks/1/",
      expect.objectContaining({ body: JSON.stringify({ assigned_to: 8 }) })
    );
  });

  it("responde 200 con la tarea editada mapeada a la forma Nexo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask({ status: "COMPLETADA" })));

    const res = await taskPATCH(jsonRequest({ status: "COMPLETADA" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("COMPLETADA");
  });
});

describe("DELETE /api/tasks/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, {}, 404));
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si la tarea está archivada", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask({ archived_month: "2026-01" })));
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 403 si Django rechaza el borrado por permisos", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, {}, 403));

    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 500 si Django falla el borrado por otro motivo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(false, {}, 500));

    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(500);
  });

  it("responde 200 cuando Django confirma el borrado", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, djangoTask()));
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, {}));

    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
