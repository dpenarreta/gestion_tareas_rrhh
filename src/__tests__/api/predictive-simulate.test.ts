import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): los 3 simuladores
// de Inteligencia Preventiva pasaron a ser wrappers delgados sobre Django
// (`SimulateAdjustTargetTimeView`/`SimulateAddParticipantsView`/
// `SimulateRedistributeLoadView`, Fase 9c) — "nunca persiste nada" ahora lo
// garantiza el propio motor de Django (`simulate_engine.py`, solo lectura).
// Acá solo se cubre ruteo/mapeo: sesión, traducción camelCase→snake_case del
// body, status codes, mapeo snake_case→camelCase de la respuesta.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { POST: simulateUserPOST } = await import("@/app/api/predictive/simulate/[userId]/route");
const { POST: redistributePOST } = await import("@/app/api/predictive/simulate/redistribute/route");
const { POST: simulateProjectPOST } = await import("@/app/api/predictive/simulate/project/[projectId]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Ana",
          email: "a@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}
function userCtx(userId = "target-1") {
  return { params: Promise.resolve({ userId }) };
}
function projectCtx(projectId = "project-1") {
  return { params: Promise.resolve({ projectId }) };
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("POST /api/predictive/simulate/[userId] — 'modificar tiempo objetivo'", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: 10 }), userCtx());
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si la tarea no pertenece al usuario objetivo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: 10 }), userCtx());
    expect(res.status).toBe(404);
  });

  it("responde 403 sin visibilidad del usuario objetivo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: 10 }), userCtx());
    expect(res.status).toBe(403);
  });

  it("responde 400 con mensaje genérico si el escenario es inválido", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { detail: "detalle interno" }, 400));
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: -5 }), userCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Escenario inválido");
  });

  it("traduce el body a snake_case y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { before: { health_score: 88 }, after: { health_score: 90 } })
    );
    const res = await simulateUserPOST(
      jsonRequest({ taskId: "t1", newTargetTimeHours: 10 }),
      userCtx("target-1")
    );
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/predictive/simulate/target-1/", {
      method: "POST",
      body: JSON.stringify({ task_id: "t1", new_target_time_hours: 10 }),
    });
    const body = await res.json();
    expect(body).toEqual({ before: { healthScore: 88 }, after: { healthScore: 90 } });
  });
});

describe("POST /api/predictive/simulate/redistribute — 'redistribuir carga'", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await redistributePOST(jsonRequest({ fromUserId: "u1", toUserId: "u2", hours: 5 }));
    expect(res.status).toBe(401);
  });

  it("responde 404 si algún usuario no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await redistributePOST(jsonRequest({ fromUserId: "u1", toUserId: "u2", hours: 5 }));
    expect(res.status).toBe(404);
  });

  it("responde 403 sin visibilidad de alguno de los dos usuarios", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await redistributePOST(jsonRequest({ fromUserId: "u1", toUserId: "u2", hours: 5 }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si origen y destino son el mismo usuario (validado en Django)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 400));
    const res = await redistributePOST(jsonRequest({ fromUserId: "u1", toUserId: "u1", hours: 5 }));
    expect(res.status).toBe(400);
  });

  it("traduce el body a snake_case y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        from: { user_id: "u1", after: { capacidad_disponible_horas: 35 } },
        to: { user_id: "u2", after: { capacidad_disponible_horas: 15 } },
      })
    );
    const res = await redistributePOST(jsonRequest({ fromUserId: "u1", toUserId: "u2", hours: 5 }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/predictive/simulate/redistribute/", {
      method: "POST",
      body: JSON.stringify({ from_user_id: "u1", to_user_id: "u2", hours: 5 }),
    });
    const body = await res.json();
    expect(body).toEqual({
      from: { userId: "u1", after: { capacidadDisponibleHoras: 35 } },
      to: { userId: "u2", after: { capacidadDisponibleHoras: 15 } },
    });
  });
});

describe("POST /api/predictive/simulate/project/[projectId] — 'agregar participantes'", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 2 }), projectCtx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el proyecto no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 2 }), projectCtx());
    expect(res.status).toBe(404);
  });

  it("responde 403 sin visibilidad del proyecto", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 2 }), projectCtx());
    expect(res.status).toBe(403);
  });

  it("responde 400 con additionalParticipants <= 0 (validado en Django)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 400));
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 0 }), projectCtx());
    expect(res.status).toBe(400);
  });

  it("traduce el body a snake_case y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { before: { avg_remaining_hours_per_participant: 40 }, after: { avg_remaining_hours_per_participant: 20 } })
    );
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 2 }), projectCtx("project-1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/predictive/simulate/project/project-1/", {
      method: "POST",
      body: JSON.stringify({ additional_participants: 2 }),
    });
    const body = await res.json();
    expect(body).toEqual({ before: { avgRemainingHoursPerParticipant: 40 }, after: { avgRemainingHoursPerParticipant: 20 } });
  });
});
