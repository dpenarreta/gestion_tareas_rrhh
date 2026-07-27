import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const userFindUnique = vi.fn();
const userFindMany = vi.fn();
const taskFindUnique = vi.fn();
const projectFindUnique = vi.fn();
// Cualquier intento de mutación debe fallar el test explícitamente — el
// simulador NUNCA debe persistir nada (§Bloque 8: "No guardar simulaciones").
const failIfCalled = (label: string) => vi.fn(() => { throw new Error(`No debería llamarse: ${label} — el simulador nunca persiste.`); });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a), findMany: (...a: unknown[]) => userFindMany(...a), update: failIfCalled("user.update"), create: failIfCalled("user.create") },
    task: { findUnique: (...a: unknown[]) => taskFindUnique(...a), update: failIfCalled("task.update"), create: failIfCalled("task.create") },
    project: { findUnique: (...a: unknown[]) => projectFindUnique(...a), update: failIfCalled("project.update"), create: failIfCalled("project.create") },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const computeCapacityForecast = vi.fn();
const computeTeamCapacityForecast = vi.fn();
vi.mock("@/lib/capacityForecast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capacityForecast")>();
  return {
    ...actual,
    computeCapacityForecast: (...a: unknown[]) => computeCapacityForecast(...a),
    computeTeamCapacityForecast: (...a: unknown[]) => computeTeamCapacityForecast(...a),
  };
});

const computeHealthScore = vi.fn();
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, computeHealthScore: (...a: unknown[]) => computeHealthScore(...a) };
});

const { getSession } = await import("@/lib/session");
const { POST: simulateUserPOST } = await import("@/app/api/predictive/simulate/[userId]/route");
const { POST: redistributePOST } = await import("@/app/api/predictive/simulate/redistribute/route");
const { POST: simulateProjectPOST } = await import("@/app/api/predictive/simulate/project/[projectId]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : { userId: "u1", role: "ASISTENTE_GH", name: "Ana", email: "a@nexo.com", expiresAt: new Date(Date.now() + 100000).toISOString(), ...overrides }
  );
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}
function userCtx(userId: string) {
  return { params: Promise.resolve({ userId }) };
}
function projectCtx(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

const CAPACITY_FIXTURE = {
  userId: "u1",
  horasRestantesHoy: 2,
  diasLaborablesRestantes: 5,
  baseFuturaTotal: 40,
  comprometidoEnProgreso: 5,
  comprometidoPendiente: 5,
  comprometidoFuturo: 10,
  disponible: 30,
  disponiblePct: 75,
  estado: "alta" as const,
  estadoColor: "green" as const,
  estadoLabel: "Puede asumir proyectos",
  tasksSinEstimar: 0,
  confiabilidad: { pct: 100, holidaysConfigured: true, tasksWithoutEstimate: 0 },
};

const HEALTH_SCORE_FIXTURE = {
  score: 88,
  classification: "Bueno",
  classificationColor: "green",
  factors: [
    { name: "Cumplimiento", rawLabel: "90%", weight: 25, points: 22.5, detail: "" },
    { name: "Carga laboral", rawLabel: "Óptimo (100%)", weight: 25, points: 25, detail: "" },
    { name: "Tareas vencidas", rawLabel: "0", weight: 20, points: 20, detail: "" },
    { name: "Consistencia", rawLabel: "Consistente", weight: 15, points: 12, detail: "" },
    { name: "Capacidad futura", rawLabel: "75%", weight: 15, points: 8.5, detail: "" },
  ],
  engineVersion: "1.5.0",
  explain: { formula: "", steps: [] },
};

describe("POST /api/predictive/simulate/[userId] — 'modificar tiempo objetivo', nunca persiste", () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    taskFindUnique.mockReset();
    computeCapacityForecast.mockReset().mockResolvedValue(CAPACITY_FIXTURE);
    computeHealthScore.mockReset().mockResolvedValue(HEALTH_SCORE_FIXTURE);
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 sin sesión", async () => {
    mockSession(null);
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: 10 }), userCtx("u1"));
    expect(res.status).toBe(401);
  });

  it("responde 400 con un escenario inválido (horas negativas)", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", role: "ASISTENTE_GH" });
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: -5 }), userCtx("u1"));
    expect(res.status).toBe(400);
  });

  it("responde 404 si la tarea no pertenece al usuario objetivo", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", role: "ASISTENTE_GH" });
    taskFindUnique.mockResolvedValue({ assignedToId: "otro-usuario", status: "PENDIENTE", estimatedHours: 5, targetTimeValidated: null, realHours: 0 });
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: 10 }), userCtx("u1"));
    expect(res.status).toBe(404);
  });

  it("responde 400 si la tarea ya está Completada (no tiene sentido simular sobre ella)", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", role: "ASISTENTE_GH" });
    taskFindUnique.mockResolvedValue({ assignedToId: "u1", status: "COMPLETADA", estimatedHours: 5, targetTimeValidated: null, realHours: 5 });
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: 10 }), userCtx("u1"));
    expect(res.status).toBe(400);
  });

  it("un escenario válido recalcula capacidad/Equilibrio Operativo y nunca llama a ninguna mutación de Prisma", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", role: "ASISTENTE_GH" });
    taskFindUnique.mockResolvedValue({ assignedToId: "u1", status: "PENDIENTE", estimatedHours: 5, targetTimeValidated: null, realHours: 0 });
    const res = await simulateUserPOST(jsonRequest({ taskId: "t1", newTargetTimeHours: 10 }), userCtx("u1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scenario).toEqual({ type: "adjust_target_time", taskId: "t1", newTargetTimeHours: 10 });
    expect(body.before.healthScore).toBe(88);
    // Subir el tiempo objetivo de 5h a 10h reduce la capacidad disponible futura.
    expect(body.after.capacidadDisponibleHoras).toBeLessThan(body.before.capacidadDisponibleHoras);
  });
});

describe("POST /api/predictive/simulate/redistribute — 'redistribuir carga', bi-usuario, nunca persiste", () => {
  beforeEach(() => {
    userFindMany.mockReset();
    computeTeamCapacityForecast.mockReset();
    vi.mocked(getSession).mockReset();
  });

  it("responde 400 si origen y destino son el mismo usuario", async () => {
    mockSession({});
    const res = await redistributePOST(jsonRequest({ fromUserId: "u1", toUserId: "u1", hours: 5 }));
    expect(res.status).toBe(400);
  });

  it("responde 403 si el solicitante no tiene visibilidad sobre alguno de los dos usuarios", async () => {
    mockSession({ userId: "u1", role: "ASISTENTE_GH" }); // solo se ve a sí mismo
    userFindMany.mockResolvedValue([
      { id: "u1", role: "ASISTENTE_GH" },
      { id: "u2", role: "JEFE_NACIONAL" },
    ]);
    const res = await redistributePOST(jsonRequest({ fromUserId: "u1", toUserId: "u2", hours: 5 }));
    expect(res.status).toBe(403);
  });

  it("redistribuye horas hipotéticamente entre dos usuarios visibles, sin persistir nada", async () => {
    mockSession({ userId: "leader-1", role: "JEFE_NACIONAL" });
    userFindMany.mockResolvedValue([
      { id: "u1", role: "ASISTENTE_GH" },
      { id: "u2", role: "ASISTENTE_GH" },
    ]);
    computeTeamCapacityForecast.mockResolvedValue(
      new Map([
        ["u1", { ...CAPACITY_FIXTURE, userId: "u1" }],
        ["u2", { ...CAPACITY_FIXTURE, userId: "u2", comprometidoFuturo: 20, disponible: 20, disponiblePct: 50 }],
      ])
    );
    const res = await redistributePOST(jsonRequest({ fromUserId: "u1", toUserId: "u2", hours: 5 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Origen: se libera capacidad; Destino: se compromete más.
    expect(body.from.after.capacidadDisponibleHoras).toBeGreaterThan(body.from.before.capacidadDisponibleHoras);
    expect(body.to.after.capacidadDisponibleHoras).toBeLessThan(body.to.before.capacidadDisponibleHoras);
  });
});

describe("POST /api/predictive/simulate/project/[projectId] — 'agregar participantes', nunca persiste", () => {
  beforeEach(() => {
    projectFindUnique.mockReset();
    vi.mocked(getSession).mockReset();
  });

  it("responde 400 con additionalParticipants <= 0", async () => {
    mockSession({});
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 0 }), projectCtx("p1"));
    expect(res.status).toBe(400);
  });

  it("responde 404 si el proyecto no existe", async () => {
    mockSession({});
    projectFindUnique.mockResolvedValue(null);
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 2 }), projectCtx("p1"));
    expect(res.status).toBe(404);
  });

  it("responde 403 sin visibilidad del proyecto", async () => {
    mockSession({ userId: "u1", role: "ASISTENTE_GH" });
    projectFindUnique.mockResolvedValue({ responsibleId: "otro", createdById: "otro2", targetTimeHours: 100, realHours: 20, participants: [] });
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 2 }), projectCtx("p1"));
    expect(res.status).toBe(403);
  });

  it("agregar participantes reduce el promedio de horas restantes por participante, sin persistir nada", async () => {
    mockSession({ userId: "u1", role: "ASISTENTE_GH" });
    projectFindUnique.mockResolvedValue({
      responsibleId: "u1",
      createdById: "otro",
      targetTimeHours: 100,
      realHours: 20,
      participants: [{ userId: "u1" }, { userId: "p2" }],
    });
    const res = await simulateProjectPOST(jsonRequest({ additionalParticipants: 2 }), projectCtx("p1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.before.participants).toBe(2);
    expect(body.after.participants).toBe(4);
    expect(body.after.avgRemainingHoursPerParticipant).toBeLessThan(body.before.avgRemainingHoursPerParticipant);
  });
});
