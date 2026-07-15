import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const userFindUnique = vi.fn();
const taskFindMany = vi.fn();
const commentCount = vi.fn();
const taskActivityCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    task: { findMany: taskFindMany },
    comment: { count: commentCount },
    taskActivity: { count: taskActivityCount },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const FAKE_CARGA_TIEMPO = {
  diaria: { realHours: 0, baseHours: 0, pct: 0, color: "green", rangeMin: 0, rangeMax: 0, label: "Óptimo", isWeekend: false },
  semanal: { realHours: 0, baseHours: 0, pct: 0, color: "green", rangeMin: 0, rangeMax: 0, label: "Óptimo" },
  mensual: { realHours: 0, baseHours: 0, pct: 0, color: "green", rangeMin: 0, rangeMax: 0, label: "Óptimo" },
  horasEfectivasPorDia: 6.5,
  workloadLimitLow: 5.5,
  workloadLimitHigh: 7.5,
  workloadLimitOverload: 8.5,
  dailyHistory: [],
  weeklyHistory: [],
};

vi.mock("@/lib/workload", () => ({
  computeCargaTiempo: vi.fn().mockResolvedValue(FAKE_CARGA_TIEMPO),
  computeCargaHistory: vi.fn().mockResolvedValue({ daily: [], weekly: [] }),
}));

const { getSession } = await import("@/lib/session");
const { GET: meGET } = await import("@/app/api/kpis/me/route");
const { GET: userIdGET } = await import("@/app/api/kpis/[userId]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
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

function getRequest(url = "http://localhost/api/kpis/me"): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function ctx(userId = "u1") {
  return { params: Promise.resolve({ userId }) };
}

function resetAll() {
  userFindUnique.mockReset();
  taskFindMany.mockReset().mockResolvedValue([]);
  commentCount.mockReset().mockResolvedValue(0);
  taskActivityCount.mockReset().mockResolvedValue(0);
  vi.mocked(getSession).mockReset();
}

// Fija "ahora" bien después del mes de prueba para que refDate = fin de mes
// de forma determinista, sin depender del reloj real de la máquina.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 1)); // 1 de agosto de 2026
});
afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/kpis/me", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meGET(getRequest());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario de la sesión ya no existe", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue(null);
    const res = await meGET(getRequest());
    expect(res.status).toBe(404);
  });

  it("sin tareas en el período, todos los porcentajes/ratios son 0 (sin división por cero)", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", name: "Ana", role: "ASISTENTE_GH" });
    taskFindMany.mockResolvedValue([]);

    const res = await meGET(getRequest("http://localhost/api/kpis/me?month=2026-06"));
    const body = await res.json();
    expect(body.cumplimiento).toMatchObject({ total: 0, completed: 0, completedPct: 0, overduePct: 0 });
    expect(body.cargaLaboral).toMatchObject({ estimatedHours: 0, realHours: 0, ratio: 0 });
    // scoreL (carga) parte de 20/20 cuando el ratio es 0 (sin sobrecarga) — el
    // score total sin tareas no es 0, solo sus componentes de cumplimiento/calidad/actividad.
    expect(body.score).toBe(20);
  });

  it("cargaRatio es 200 cuando hay horas reales pero cero horas estimadas", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", name: "Ana", role: "ASISTENTE_GH" });
    taskFindMany.mockResolvedValue([
      { id: "t1", status: "COMPLETADA", type: "FIJA", frequency: "PUNTUAL", endDate: new Date("2026-06-10"),
        estimatedHours: 0, realHours: 3, progress: 100, createdById: "u1", activities: [] },
    ]);
    const res = await meGET(getRequest("http://localhost/api/kpis/me?month=2026-06"));
    const body = await res.json();
    expect(body.cargaLaboral.ratio).toBe(200);
  });

  it("calcula cumplimiento, carga laboral y score a partir de las tareas del período", async () => {
    mockSession({ userId: "u1" });
    userFindUnique.mockResolvedValue({ id: "u1", name: "Ana", role: "ASISTENTE_GH" });
    commentCount.mockResolvedValue(2);
    taskFindMany.mockResolvedValueOnce([
      { id: "t1", status: "COMPLETADA", type: "FIJA", frequency: "PUNTUAL", endDate: new Date("2026-06-10"),
        estimatedHours: 4, realHours: 5, progress: 100, createdById: "u1", activities: [] },
      { id: "t2", status: "PENDIENTE", type: "FIJA", frequency: "PUNTUAL", endDate: new Date("2026-06-05"),
        estimatedHours: 3, realHours: 0, progress: 0, createdById: "otro", activities: [] },
      { id: "t3", status: "EN_PROGRESO", type: "SEGUIMIENTO", frequency: "MENSUAL", endDate: new Date("2026-06-20"),
        estimatedHours: 2, realHours: 1, progress: 50, createdById: "u1",
        activities: [{ reason: "CONSULTA", duration: 30 }] },
    ]);

    const res = await meGET(getRequest("http://localhost/api/kpis/me?month=2026-06"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cumplimiento.total).toBe(3);
    expect(body.cumplimiento.completed).toBe(1);
    expect(body.cumplimiento.completedPct).toBe(Math.round((1 / 3) * 100));
    // t2 (PENDIENTE, vencida hace semanas) cuenta como atrasada; t1 completada nunca.
    expect(body.cumplimiento.overdue).toBeGreaterThanOrEqual(1);

    expect(body.cargaLaboral.estimatedHours).toBe(9);
    expect(body.cargaLaboral.realHours).toBe(6);
    expect(body.cargaLaboral.ratio).toBe(Math.round((6 / 9) * 100));

    expect(body.seguimiento.total).toBe(1);
    expect(body.seguimiento.byReason).toEqual([{ reason: "CONSULTA", count: 1, totalMinutes: 30, avgMinutes: 30 }]);

    expect(body.calidad.avgProgress).toBe(50); // único EN_PROGRESO
    expect(body.calidad.recurringTotal).toBe(1); // t3 es MENSUAL
    expect(body.calidad.recurringCompleted).toBe(0);

    expect(body.actividad).toEqual({ totalComments: 2, assignedByOthers: 1, ownTasks: 2 });
    expect(typeof body.score).toBe("number");
    expect(body.tasks).toHaveLength(3);
  });

  it("usa el mes actual por defecto cuando no se pasa el parámetro month", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", name: "Ana", role: "ASISTENTE_GH" });
    const res = await meGET(getRequest("http://localhost/api/kpis/me"));
    const body = await res.json();
    expect(body.period.month).toBe("2026-08"); // coincide con el reloj falseado (1 ago 2026)
  });
});

describe("GET /api/kpis/[userId]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await userIdGET(getRequest(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue(null);
    const res = await userIdGET(getRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el objetivo está fuera de la jerarquía visible del solicitante", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    userFindUnique.mockResolvedValue({ id: "target-1", name: "Jefe", role: "JEFE_NACIONAL" });
    const res = await userIdGET(getRequest(), ctx("target-1"));
    expect(res.status).toBe(403);
  });

  it("un gestor dentro de la jerarquía visible obtiene los KPIs del subordinado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindUnique.mockResolvedValue({ id: "target-1", name: "Ana", role: "ASISTENTE_GH" });
    taskFindMany.mockResolvedValue([]);
    const res = await userIdGET(getRequest(), ctx("target-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: "target-1", name: "Ana", role: "ASISTENTE_GH" });
  });
});
