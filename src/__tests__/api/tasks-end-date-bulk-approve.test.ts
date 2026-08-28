import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Sub-fase 3c-bulk de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): POST /api/tasks/end-date/bulk-approve pasó de Prisma a
// Django — este archivo mockeaba `@/lib/prisma` hasta esta actualización,
// probando lógica (permisos, aprobar/modificar según cambió la fecha,
// validación de fecha anterior a startDate) que ya NO vive en `route.ts`.
// Acá solo se cubre lo que el wrapper de Next.js realmente hace.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { POST: bulkApprovePOST } = await import("@/app/api/tasks/end-date/bulk-approve/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ADMINISTRADOR",
          name: "Admin",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function postRequest(body: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("POST /api/tasks/end-date/bulk-approve", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await bulkApprovePOST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await bulkApprovePOST(postRequest({ items: [{ taskId: "1" }] }));
    expect(res.status).toBe(403);
  });

  it("responde 400 con el mensaje de Django si no se seleccionó ninguna tarea", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: { details: { non_field_errors: ["Debes seleccionar al menos una tarea"] } } }, 400)
    );
    const res = await bulkApprovePOST(postRequest({ items: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Debes seleccionar al menos una tarea");
  });

  it("mapea items a snake_case (taskId->task_id, newEndDate vacío/ausente a null)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { updated_count: 0, skipped_self_assigned: [], skipped_invalid_date: [] }));

    await bulkApprovePOST(
      postRequest({ items: [{ taskId: "1", newEndDate: "2026-08-20" }, { taskId: "2" }], observaciones: "  ok  " })
    );

    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/tasks/end-date/bulk-approve/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          items: [
            { task_id: "1", new_end_date: "2026-08-20" },
            { task_id: "2", new_end_date: null },
          ],
          observaciones: "ok",
        }),
      })
    );
  });

  it("devuelve el resultado mapeado a la forma Nexo (ids como string)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { updated_count: 2, skipped_self_assigned: [3], skipped_invalid_date: [4, 5] })
    );

    const res = await bulkApprovePOST(postRequest({ items: [{ taskId: "1" }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      updatedCount: 2,
      skippedSelfAssigned: ["3"],
      skippedInvalidDate: ["4", "5"],
    });
  });
});
