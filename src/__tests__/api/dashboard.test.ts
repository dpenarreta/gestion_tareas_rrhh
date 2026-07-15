import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userFindMany = vi.fn();
const taskFindMany = vi.fn();
const announcementFindMany = vi.fn();
const meetingFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate, findMany: userFindMany },
    task: { findMany: taskFindMany },
    announcement: { findMany: announcementFindMany },
    meeting: { findMany: meetingFindMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const getVisibleIdeaAuthorIds = vi.fn();
vi.mock("@/lib/ideas", () => ({ getVisibleIdeaAuthorIds: (...a: unknown[]) => getVisibleIdeaAuthorIds(...a) }));

const { getSession } = await import("@/lib/session");
const { GET: dashboardGET } = await import("@/app/api/dashboard/route");
const { PATCH: cardOrderPATCH } = await import("@/app/api/dashboard/card-order/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "JEFE_NACIONAL",
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

function resetAll() {
  userFindUnique.mockReset();
  userUpdate.mockReset().mockResolvedValue({});
  userFindMany.mockReset().mockResolvedValue([]);
  taskFindMany.mockReset().mockResolvedValue([]);
  announcementFindMany.mockReset().mockResolvedValue([]);
  meetingFindMany.mockReset().mockResolvedValue([]);
  getVisibleIdeaAuthorIds.mockReset().mockResolvedValue([]);
  vi.mocked(getSession).mockReset();
}

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await dashboardGET();
    expect(res.status).toBe(401);
  });

  it("responde 500 ante un error inesperado", async () => {
    mockSession({});
    userFindUnique.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await dashboardGET();
    expect(res.status).toBe(500);
  });

  it("prioriza las tareas vencidas con la mayor urgencia y calcula el resumen del dashboard", async () => {
    mockSession({ userId: "u1", role: "JEFE_NACIONAL" });
    userFindUnique.mockResolvedValue({ lastLoginAt: new Date("2026-08-10T00:00:00Z"), badges: ["cumplidor"] });
    taskFindMany.mockResolvedValue([
      { id: "t1", title: "Vencida", status: "PENDIENTE", endDate: new Date("2026-07-01"), estimatedHours: 2, realHours: 1 },
      { id: "t2", title: "Completada", status: "COMPLETADA", endDate: new Date("2026-08-15"), estimatedHours: 3, realHours: 3 },
    ]);
    announcementFindMany.mockResolvedValue([]);
    meetingFindMany.mockResolvedValue([]);

    const res = await dashboardGET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.overdue).toBe(1);
    expect(body.priorityTasks[0]).toMatchObject({ id: "t1", urgency: 4 });
    expect(body.badges).toEqual(["cumplidor"]);
    expect(body.lastLoginAt).toBe("2026-08-10T00:00:00.000Z");
    expect(body.teamAlerts).toBe(0); // sin subordinados visibles (userFindMany -> [])
    expect(body.areaActivity).toEqual([]);
  });

  it("no calcula alertas de equipo para roles de nivel 1", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    userFindUnique.mockResolvedValue({ lastLoginAt: null, badges: [] });
    const res = await dashboardGET();
    const body = await res.json();
    expect(body.teamAlerts).toBe(0);
  });
});

describe("PATCH /api/dashboard/card-order", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await cardOrderPATCH(jsonRequest({ order: ["a"] }));
    expect(res.status).toBe(401);
  });

  it("responde 400 si order no es un array no vacío", async () => {
    mockSession({});
    expect((await cardOrderPATCH(jsonRequest({ order: [] }))).status).toBe(400);
    expect((await cardOrderPATCH(jsonRequest({ order: "a,b" }))).status).toBe(400);
  });

  it("reemplaza solo la entrada DASHBOARD_CARDS, preservando otras preferencias", async () => {
    mockSession({ userId: "u1" });
    userFindUnique.mockResolvedValue({ viewPreferences: ["tasks:kanban", "DASHBOARD_CARDS:old,order"] });
    const res = await cardOrderPATCH(jsonRequest({ order: ["carga", "tareas", "reuniones"] }));
    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { viewPreferences: ["tasks:kanban", "DASHBOARD_CARDS:carga,tareas,reuniones"] },
    });
  });

  it("funciona sin preferencias previas", async () => {
    mockSession({ userId: "u1" });
    userFindUnique.mockResolvedValue(null);
    await cardOrderPATCH(jsonRequest({ order: ["carga"] }));
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { viewPreferences: ["DASHBOARD_CARDS:carga"] },
    });
  });
});
