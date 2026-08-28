import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django — la lógica real (permisos,
// traducción de prioridad, reutilización de TaskService.create_task) ya
// vive en `DeskReminderViewSet.convert_to_task`, cubierta en
// `backend/apps/desk/tests/`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { POST: convertToTask } = await import("@/app/api/desk-reminders/[id]/convert-to-task/route");

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

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const CONVERT_BODY = { startDate: "2026-08-01", endDate: "2026-08-08", estimatedHours: 1 };

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("POST /api/desk-reminders/[id]/convert-to-task", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el recordatorio no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien convierte no es el dueño del recordatorio", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 409 si ya fue convertido antes", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 409));
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(409);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: { details: { estimated_hours: ["Faltan campos requeridos"] } } }, 400));
    const res = await convertToTask(jsonRequest({}), ctx());
    expect(res.status).toBe(400);
  });

  it("mapea el body a snake_case y devuelve taskId/taskTitle", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { task_id: 9, task_title: "Llamar a Finanzas" }, 201));

    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx("1"));
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/desk-reminders/1/convert-to-task/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: undefined,
          type: undefined,
          frequency: undefined,
          start_date: "2026-08-01",
          end_date: "2026-08-08",
          estimated_hours: 1,
        }),
      })
    );
    expect(await res.json()).toEqual({ taskId: "9", taskTitle: "Llamar a Finanzas" });
  });
});
