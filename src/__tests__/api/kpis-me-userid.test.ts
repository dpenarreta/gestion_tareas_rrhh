import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";
import type { CargaTiempo } from "@/components/kpis/types";

const userFindUnique = vi.fn();
const taskFindMany = vi.fn();
const commentCount = vi.fn();
const taskActivityCount = vi.fn();
const taskActivityFindFirst = vi.fn();
const taskActivityFindMany = vi.fn();
const systemConfigHistoryFindFirst = vi.fn();
const holidayFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    task: { findMany: taskFindMany },
    comment: { count: commentCount },
    // findMany se usa en el cálculo de Carga Laboral del mes anterior
    // (mismo patrón de horas reales que computeCargaTiempo/reports/custom-range).
    taskActivity: { count: taskActivityCount, findFirst: taskActivityFindFirst, findMany: taskActivityFindMany },
    // computeRiskAlerts ahora lee alertOverdueTaskThreshold vía
    // getEffectiveAnalyticsConfig (ver Analytics Calculation Registry § D2)
    // y el set de feriados vía getHolidaySet (ver § D9).
    systemConfigHistory: { findFirst: systemConfigHistoryFindFirst },
    holiday: { findMany: holidayFindMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const FAKE_CARGA_TIEMPO: CargaTiempo = {
  diaria: {
    realHours: 0, baseHours: 0, pct: 0, color: "green", rangeMin: 0, rangeMax: 0, label: "Óptimo", isWeekend: false,
    isHoliday: false,
    medicoLeaveMinutes: 120, medicoLeaveFullDay: false,
    personalLeaveMinutes: 0, personalLeaveFullDay: false,
    vacacionesFullDay: false,
    specialStatusType: "MATERNIDAD",
  },
  semanal: {
    realHours: 0, baseHours: 0, pct: 0, color: "green", rangeMin: 0, rangeMax: 0, label: "Óptimo", isWeekend: false,
    weekStartLabel: "01/06", weekEndLabel: "07/06", businessDays: 5, weekendHours: 0, specialStatusType: "MATERNIDAD",
  },
  mensual: {
    realHours: 0, baseHours: 0, pct: 0, color: "green", rangeMin: 0, rangeMax: 0, label: "Óptimo", isWeekend: false,
    monthLabel: "junio 2026", businessDays: 20, weekendHours: 0, holidayHours: 0,
    medicoLeaveMinutes: 120, personalLeaveMinutes: 0, vacacionesMinutes: 0,
    specialStatusType: "MATERNIDAD",
  },
  horasEfectivasPorDia: 6.5,
  workloadLimitLow: 5.5,
  workloadLimitHigh: 7.5,
  workloadLimitOverload: 8.5,
  effectiveHoursPerDia: 6.5,
  effectiveLimitLow: 5.5,
  effectiveLimitBase: 6.5,
  effectiveLimitHigh: 7.5,
  effectiveLimitOverload: 8.5,
  kpiStartDate: null,
  dailyHistory: [],
  weeklyHistory: [],
  sensitiveDetailVisible: true,
};

vi.mock("@/lib/workload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workload")>("@/lib/workload");
  return {
    ...actual,
    computeCargaTiempo: vi.fn().mockResolvedValue(FAKE_CARGA_TIEMPO),
    computeCargaHistory: vi.fn().mockResolvedValue({ daily: [], weekly: [] }),
  };
});

const { getSession } = await import("@/lib/session");
const { computeCargaTiempo } = await import("@/lib/workload");
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
  taskActivityFindFirst.mockReset().mockResolvedValue(null);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  systemConfigHistoryFindFirst.mockReset().mockResolvedValue(null);
  holidayFindMany.mockReset().mockResolvedValue([]);
  vi.mocked(getSession).mockReset();
  vi.mocked(computeCargaTiempo).mockReset().mockResolvedValue(FAKE_CARGA_TIEMPO);
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

  it("cargaRatio (estimado-vs-real) es 200 cuando hay horas reales pero cero horas estimadas — usado solo por el Score básico, no por el indicador Carga Laboral", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", name: "Ana", role: "ASISTENTE_GH" });
    taskFindMany.mockResolvedValue([
      { id: "t1", status: "COMPLETADA", type: "FIJA", frequency: "PUNTUAL", endDate: new Date("2026-06-10"),
        estimatedHours: 0, realHours: 3, progress: 100, createdById: "u1", activities: [] },
    ]);
    const res = await meGET(getRequest("http://localhost/api/kpis/me?month=2026-06"));
    const body = await res.json();
    // scoreL = 20 - max(0, 200-100)*0.5 = 20-50 → clamp a 0; scoreC=0 (no completadas a
    // tiempo, sin completedAt); confirma que el 200% de computeEstimatedVsRealRatio sigue
    // penalizando el Score básico aunque ya no se exponga como cargaLaboral.ratio.
    expect(body.score).toBe(0);
    // El indicador "Carga Laboral" NO debe reflejar este 200% — viene de
    // cargaTiempo.mensual (mockeado en 0 en este test), no de las tareas.
    expect(body.cargaLaboral.ratio).not.toBe(200);
  });

  it("el indicador 'Carga Laboral' usa cargaTiempo.mensual (Base Horaria Efectiva), no las horas estimadas/reales de las tareas — regresión del bug reportado 2026-07-28", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1", name: "Ana", role: "ASISTENTE_GH" });
    vi.mocked(computeCargaTiempo).mockResolvedValueOnce({
      ...FAKE_CARGA_TIEMPO,
      mensual: { ...FAKE_CARGA_TIEMPO.mensual, realHours: 135.49, baseHours: 140, pct: 97, color: "yellow", label: "Moderado" },
    });
    // Horas de tareas deliberadamente muy distintas (200/113.28) de las de
    // cargaTiempo.mensual — antes del fix, cargaLaboral usaba estos valores.
    taskFindMany.mockResolvedValue([
      { id: "t1", status: "COMPLETADA", type: "FIJA", frequency: "PUNTUAL", endDate: new Date("2026-06-10"),
        completedAt: new Date("2026-06-09"), estimatedHours: 200, realHours: 113.28, progress: 100, createdById: "u1", activities: [] },
    ]);
    const res = await meGET(getRequest("http://localhost/api/kpis/me?month=2026-06"));
    const body = await res.json();
    expect(body.cargaLaboral).toMatchObject({ estimatedHours: 140, realHours: 135.49, ratio: 97, color: "yellow" });
  });

  it("calcula cumplimiento, carga laboral y score a partir de las tareas del período", async () => {
    mockSession({ userId: "u1" });
    userFindUnique.mockResolvedValue({ id: "u1", name: "Ana", role: "ASISTENTE_GH" });
    commentCount.mockResolvedValue(2);
    taskFindMany.mockResolvedValueOnce([
      { id: "t1", status: "COMPLETADA", type: "FIJA", frequency: "PUNTUAL", endDate: new Date("2026-06-10"),
        completedAt: new Date("2026-06-09"), estimatedHours: 4, realHours: 5, progress: 100, createdById: "u1", activities: [] },
      { id: "t2", status: "PENDIENTE", type: "FIJA", frequency: "PUNTUAL", endDate: new Date("2026-06-05"),
        completedAt: null, estimatedHours: 3, realHours: 0, progress: 0, createdById: "otro", activities: [] },
      { id: "t3", status: "EN_PROGRESO", type: "SEGUIMIENTO", frequency: "MENSUAL", endDate: new Date("2026-06-20"),
        completedAt: null, estimatedHours: 2, realHours: 1, progress: 50, createdById: "u1",
        activities: [{ reason: "CONSULTA", duration: 30 }] },
    ]);

    const res = await meGET(getRequest("http://localhost/api/kpis/me?month=2026-06"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cumplimiento.total).toBe(3);
    expect(body.cumplimiento.completed).toBe(1);
    // t1 se completó A TIEMPO (completedAt <= endDate) — cumplimiento general
    // debe usar la misma definición que cumplimientoPorPrioridad (ver Sprint 1 S1-A).
    expect(body.cumplimiento.completedOnTime).toBe(1);
    expect(body.cumplimiento.completedPct).toBe(Math.round((1 / 3) * 100));
    // t2 (PENDIENTE, vencida hace semanas) cuenta como atrasada; t1 completada nunca.
    expect(body.cumplimiento.overdue).toBeGreaterThanOrEqual(1);

    // cargaLaboral viene de cargaTiempo.mensual (mockeado en FAKE_CARGA_TIEMPO,
    // todo en 0 por defecto), NO de la suma de estimatedHours/realHours de las
    // tareas (9h/6h) — esas horas solo alimentan cargaRatio → Score básico.
    expect(body.cargaLaboral).toMatchObject({ estimatedHours: 0, realHours: 0, ratio: 0 });

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

  // Los permisos médicos y el estado de maternidad/lactancia son datos de salud
  // (Art. 26 LOPDP) — un superior en la jerarquía distinto del Administrador solo
  // debe ver que hay horas de ausencia justificada, no el tipo específico.
  it("un JEFE_NACIONAL viendo a un subordinado recibe el detalle de permisos/estado especial redactado", async () => {
    mockSession({ userId: "boss-1", role: "JEFE_NACIONAL" });
    userFindUnique.mockResolvedValue({ id: "target-1", name: "Ana", role: "ASISTENTE_GH" });
    taskFindMany.mockResolvedValue([]);
    const res = await userIdGET(getRequest(), ctx("target-1"));
    const body = await res.json();
    expect(body.cargaTiempo.sensitiveDetailVisible).toBe(false);
    expect(body.cargaTiempo.diaria.medicoLeaveMinutes).toBe(0);
    expect(body.cargaTiempo.diaria.specialStatusType).toBeNull();
    // El total de minutos de ausencia se conserva de forma genérica (personalLeaveMinutes).
    expect(body.cargaTiempo.diaria.personalLeaveMinutes).toBe(120);
    expect(body.cargaTiempo.mensual.medicoLeaveMinutes).toBe(0);
    expect(body.cargaTiempo.mensual.vacacionesMinutes).toBe(0);
    expect(body.cargaTiempo.mensual.specialStatusType).toBeNull();
  });

  it("un ADMINISTRADOR viendo a un subordinado recibe el detalle completo de permisos/estado especial", async () => {
    mockSession({ userId: "admin-1", role: "ADMINISTRADOR" });
    userFindUnique.mockResolvedValue({ id: "target-1", name: "Ana", role: "ASISTENTE_GH" });
    taskFindMany.mockResolvedValue([]);
    const res = await userIdGET(getRequest(), ctx("target-1"));
    const body = await res.json();
    expect(body.cargaTiempo.sensitiveDetailVisible).toBe(true);
    expect(body.cargaTiempo.diaria.medicoLeaveMinutes).toBe(120);
    expect(body.cargaTiempo.diaria.specialStatusType).toBe("MATERNIDAD");
  });

  it("un usuario viendo sus propios KPIs vía /api/kpis/[userId] recibe el detalle completo", async () => {
    mockSession({ userId: "target-1", role: "ASISTENTE_GH" });
    userFindUnique.mockResolvedValue({ id: "target-1", name: "Ana", role: "ASISTENTE_GH" });
    taskFindMany.mockResolvedValue([]);
    const res = await userIdGET(getRequest(), ctx("target-1"));
    const body = await res.json();
    expect(body.cargaTiempo.sensitiveDetailVisible).toBe(true);
    expect(body.cargaTiempo.diaria.medicoLeaveMinutes).toBe(120);
  });
});
