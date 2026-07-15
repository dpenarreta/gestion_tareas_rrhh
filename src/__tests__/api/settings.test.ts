import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const getEffectiveHorasEfectivas = vi.fn();
const getEffectiveWorkloadLimitLow = vi.fn();
const getEffectiveWorkloadLimitHigh = vi.fn();
const getEffectiveWorkloadLimitOverload = vi.fn();
const setConfigValue = vi.fn();

vi.mock("@/lib/systemConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/systemConfig")>();
  return {
    ...actual,
    getEffectiveHorasEfectivas: (...a: unknown[]) => getEffectiveHorasEfectivas(...a),
    getEffectiveWorkloadLimitLow: (...a: unknown[]) => getEffectiveWorkloadLimitLow(...a),
    getEffectiveWorkloadLimitHigh: (...a: unknown[]) => getEffectiveWorkloadLimitHigh(...a),
    getEffectiveWorkloadLimitOverload: (...a: unknown[]) => getEffectiveWorkloadLimitOverload(...a),
    setConfigValue: (...a: unknown[]) => setConfigValue(...a),
  };
});

const getEffectivePolicy = vi.fn();
const findPurgeCandidates = vi.fn();
const executePurge = vi.fn();

vi.mock("@/lib/retentionPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/retentionPolicy")>();
  return {
    ...actual,
    getEffectivePolicy: (...a: unknown[]) => getEffectivePolicy(...a),
    findPurgeCandidates: (...a: unknown[]) => findPurgeCandidates(...a),
    executePurge: (...a: unknown[]) => executePurge(...a),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(10) },
    task: { count: vi.fn().mockResolvedValue(20) },
    meeting: { count: vi.fn().mockResolvedValue(3) },
    improvementIdea: { count: vi.fn().mockResolvedValue(5) },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: retentionGET, PUT: retentionPUT } = await import("@/app/api/settings/retention-policy/route");
const { GET: purgeGET, POST: purgePOST } = await import("@/app/api/settings/retention-policy/purge/route");
const { GET: systemInfoGET } = await import("@/app/api/settings/system-info/route");
const { GET: workloadGET, PUT: workloadPUT } = await import("@/app/api/settings/workload-config/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ADMINISTRADOR",
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

function badJsonRequest() {
  return { json: async () => { throw new Error("bad"); } } as never;
}

function resetAll() {
  getEffectiveHorasEfectivas.mockReset().mockResolvedValue(6.5);
  getEffectiveWorkloadLimitLow.mockReset().mockResolvedValue(5.5);
  getEffectiveWorkloadLimitHigh.mockReset().mockResolvedValue(7.5);
  getEffectiveWorkloadLimitOverload.mockReset().mockResolvedValue(8.5);
  setConfigValue.mockReset().mockResolvedValue(undefined);
  getEffectivePolicy.mockReset().mockResolvedValue({ monthlyReportsMonths: "24", archivedTasksMonths: "24", knowledgeDocsMonths: "indefinite" });
  findPurgeCandidates.mockReset();
  executePurge.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET/PUT /api/settings/retention-policy", () => {
  beforeEach(resetAll);

  it("GET responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await retentionGET();
    expect(res.status).toBe(401);
  });

  it("GET devuelve la política efectiva vigente", async () => {
    mockSession({});
    const res = await retentionGET();
    const body = await res.json();
    expect(body.monthlyReportsMonths).toBe("24");
  });

  it("PUT responde 403 para un rol no Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await retentionPUT(jsonRequest({}));
    expect(res.status).toBe(403);
  });

  it("PUT responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await retentionPUT(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("PUT responde 400 ante una opción de retención inválida", async () => {
    mockSession({});
    const res = await retentionPUT(jsonRequest({ monthlyReportsMonths: "999" }));
    expect(res.status).toBe(400);
    expect(setConfigValue).not.toHaveBeenCalled();
  });

  it("PUT solo actualiza los campos provistos", async () => {
    mockSession({ userId: "admin-1" });
    await retentionPUT(jsonRequest({ archivedTasksMonths: "12" }));
    expect(setConfigValue).toHaveBeenCalledTimes(1);
    expect(setConfigValue).toHaveBeenCalledWith("retention_archived_tasks", "12", "admin-1");
  });
});

describe("GET/POST /api/settings/retention-policy/purge", () => {
  beforeEach(resetAll);

  it("GET responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await purgeGET()).status).toBe(401);
    mockSession({ role: "JEFE_NACIONAL" });
    expect((await purgeGET()).status).toBe(403);
  });

  it("GET devuelve la vista previa de candidatos a depurar", async () => {
    mockSession({});
    findPurgeCandidates.mockResolvedValue({ policy: {}, reportIds: ["r1", "r2"], taskIds: ["t1"], docIds: [] });
    const res = await purgeGET();
    const body = await res.json();
    expect(body).toMatchObject({ reportsToDelete: 2, tasksToDelete: 1, docsToDelete: 0 });
  });

  it("POST responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await purgePOST(jsonRequest({}))).status).toBe(401);
    mockSession({ role: "JEFE_NACIONAL" });
    expect((await purgePOST(jsonRequest({}))).status).toBe(403);
  });

  it("POST responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await purgePOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("POST responde 400 sin confirmación explícita", async () => {
    mockSession({});
    const res = await purgePOST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(executePurge).not.toHaveBeenCalled();
  });

  it("POST ejecuta la depuración con confirm=true", async () => {
    mockSession({ userId: "admin-1" });
    executePurge.mockResolvedValue({ reportsDeleted: 2, tasksDeleted: 1, docsDeleted: 0 });
    const res = await purgePOST(jsonRequest({ confirm: true }));
    expect(res.status).toBe(200);
    expect(executePurge).toHaveBeenCalledWith("admin-1");
  });
});

describe("GET /api/settings/system-info", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await systemInfoGET()).status).toBe(401);
    mockSession({ role: "JEFE_NACIONAL" });
    expect((await systemInfoGET()).status).toBe(403);
  });

  it("devuelve los conteos globales del sistema", async () => {
    mockSession({});
    const res = await systemInfoGET();
    const body = await res.json();
    expect(body).toMatchObject({ totalUsers: 10, totalTasks: 20, totalMeetings: 3, totalIdeas: 5 });
  });
});

describe("GET/PUT /api/settings/workload-config", () => {
  beforeEach(resetAll);

  it("GET responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await workloadGET();
    expect(res.status).toBe(401);
  });

  it("GET devuelve los 4 valores efectivos", async () => {
    mockSession({});
    const res = await workloadGET();
    const body = await res.json();
    expect(body).toEqual({ hoursPerDay: 6.5, workloadLimitLow: 5.5, workloadLimitHigh: 7.5, workloadLimitOverload: 8.5 });
  });

  it("PUT responde 403 para un rol no Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await workloadPUT(jsonRequest({}));
    expect(res.status).toBe(403);
  });

  it("PUT responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await workloadPUT(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("PUT responde 400 si no se envía ningún campo", async () => {
    mockSession({});
    const res = await workloadPUT(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("PUT responde 400 si hoursPerDay está fuera de [4,8]", async () => {
    mockSession({});
    const res = await workloadPUT(jsonRequest({ hoursPerDay: 9 }));
    expect(res.status).toBe(400);
  });

  it("PUT responde 400 si un límite no es un número finito", async () => {
    mockSession({});
    const res = await workloadPUT(jsonRequest({ workloadLimitLow: Number.NaN }));
    expect(res.status).toBe(400);
  });

  it("PUT responde 400 si el orden de los límites queda inconsistente", async () => {
    mockSession({});
    // low(5.5) < hours(6.5) <= high(7.5) < overload — se rompe si low llega a igualar hours.
    const res = await workloadPUT(jsonRequest({ workloadLimitLow: 6.5 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/deben mantener el orden/);
  });

  it("PUT guarda solo los campos provistos y devuelve los valores efectivos finales", async () => {
    mockSession({ userId: "admin-1" });
    const res = await workloadPUT(jsonRequest({ hoursPerDay: 7 }));
    expect(res.status).toBe(200);
    expect(setConfigValue).toHaveBeenCalledTimes(1);
    expect(setConfigValue).toHaveBeenCalledWith("HORAS_EFECTIVAS_DIA", "7", "admin-1");
  });
});
