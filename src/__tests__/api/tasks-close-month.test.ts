import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

const monthClosureFindUnique = vi.fn();
const monthClosureCreate = vi.fn();
const taskFindMany = vi.fn();
const taskCount = vi.fn();
const taskUpdateMany = vi.fn();
const taskCreateMany = vi.fn();
const $transaction = vi.fn(async (ops: unknown[]) => Promise.all(ops));
// businessBaseForRange (workload.ts) — invocado por buildPreview desde este sprint
// (Motor de Cierre Inteligente con Fecha de Corte) para calcular días/horas hábiles
// considerados hasta el corte. Sin relación con el cierre en sí (holiday/config globales).
const holidayFindMany = vi.fn();
const systemConfigHistoryFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monthClosure: { findUnique: monthClosureFindUnique, create: monthClosureCreate },
    task: { findMany: taskFindMany, count: taskCount, updateMany: taskUpdateMany, createMany: taskCreateMany },
    holiday: { findMany: holidayFindMany },
    systemConfigHistory: { findFirst: systemConfigHistoryFindFirst },
    $transaction,
  },
}));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/tasks/close-month/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Test",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function postRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function resetPrismaMocks() {
  monthClosureFindUnique.mockReset();
  monthClosureCreate.mockReset();
  taskFindMany.mockReset();
  taskCount.mockReset();
  taskUpdateMany.mockReset();
  taskCreateMany.mockReset();
  $transaction.mockReset();
  $transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  holidayFindMany.mockReset();
  holidayFindMany.mockResolvedValue([]);
  systemConfigHistoryFindFirst.mockReset();
  systemConfigHistoryFindFirst.mockResolvedValue(null); // sin historial -> usa los defaults de systemConfig.ts
}

describe("GET /api/tasks/close-month", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    resetPrismaMocks();
    mockSession({ role: "JEFE_NACIONAL" });
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(getRequest("http://localhost/api/tasks/close-month"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de gestión de usuarios (no puede cerrar el mes)", async () => {
    mockSession({ role: "ANALISTA_SELECCION" });
    const res = await GET(getRequest("http://localhost/api/tasks/close-month"));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el mes en la query es inválido", async () => {
    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=13"));
    expect(res.status).toBe(400);
  });

  it("calcula el preview para un año/mes explícito, incluyendo el fin de mes en UTC", async () => {
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([
      { status: "COMPLETADA" },
      { status: "COMPLETADA" },
      { status: "PENDIENTE" },
      { status: "EN_PROGRESO" },
    ]);
    taskCount.mockResolvedValue(3);

    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      year: 2026,
      month: 7,
      alreadyClosed: false,
      total: 4,
      completed: 2,
      pending: 1,
      inProgress: 1,
      continuedActive: 3,
    });
    expect(body.monthEnd).toBe(new Date(Date.UTC(2026, 7, 1)).toISOString());
  });

  it("marca alreadyClosed=true si ya existe un MonthClosure para ese mes", async () => {
    monthClosureFindUnique.mockResolvedValue({ id: "closure-1", cutoffDate: new Date(Date.UTC(2026, 5, 30)), closureType: "NORMAL" });
    taskFindMany.mockResolvedValue([]);
    taskCount.mockResolvedValue(0);

    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=6"));
    const body = await res.json();
    expect(body.alreadyClosed).toBe(true);
  });

  it("sin año/mes en la query, usa el mes calendario anterior al actual", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15)); // 15 de marzo de 2026 (hora local del sistema)
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([]);
    taskCount.mockResolvedValue(0);

    const res = await GET(getRequest("http://localhost/api/tasks/close-month"));
    const body = await res.json();
    expect(body).toMatchObject({ year: 2026, month: 2 });
    vi.useRealTimers();
  });
});

describe("GET /api/tasks/close-month — Motor de Cierre Inteligente con Fecha de Corte", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    resetPrismaMocks();
    mockSession({ role: "JEFE_NACIONAL" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sin cutoffDate, el corte por defecto es el último día del mes y closureType es NORMAL", async () => {
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([]);
    taskCount.mockResolvedValue(0);

    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7"));
    const body = await res.json();
    expect(body.cutoffDate).toBe("2026-07-31");
    expect(body.closureType).toBe("NORMAL");
    expect(body.calendarDaysTotal).toBe(31);
    expect(body.calendarDaysConsidered).toBe(31);
  });

  it("con cutoffDate anterior al fin de mes y el cierre ejecutado ANTES de que el mes termine, closureType es EARLY", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 20, 12))); // 20 de julio de 2026, dentro del propio mes
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([]);
    taskCount.mockResolvedValue(0);

    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7&cutoffDate=2026-07-18"));
    const body = await res.json();
    expect(body.closureType).toBe("EARLY");
    expect(body.cutoffDate).toBe("2026-07-18");
    expect(body.calendarDaysConsidered).toBe(18);
  });

  it("con cutoffDate anterior al fin de mes pero el cierre ejecutado DESPUÉS de que el mes terminó, closureType es MANUAL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 12))); // 2 de agosto de 2026 — julio ya terminó
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([]);
    taskCount.mockResolvedValue(0);

    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7&cutoffDate=2026-07-28"));
    const body = await res.json();
    expect(body.closureType).toBe("MANUAL");
  });

  it("responde 400 si la fecha de corte cae fuera del mes seleccionado", async () => {
    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7&cutoffDate=2026-08-01"));
    expect(res.status).toBe(400);
  });

  it("responde 400 si la fecha de corte es anterior al inicio del mes", async () => {
    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7&cutoffDate=2026-06-30"));
    expect(res.status).toBe(400);
  });

  it("responde 400 si la fecha de corte es posterior a hoy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 10)));
    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7&cutoffDate=2026-07-15"));
    expect(res.status).toBe(400);
  });

  it("responde 400 si la fecha de corte tiene formato inválido", async () => {
    const res = await GET(getRequest("http://localhost/api/tasks/close-month?year=2026&month=7&cutoffDate=not-a-date"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/tasks/close-month", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    resetPrismaMocks();
    mockSession({ role: "JEFE_NACIONAL" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de cierre mensual", async () => {
    mockSession({ role: "TRABAJO_SOCIAL" });
    const res = await POST(postRequest({}));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el año/mes del body es inválido", async () => {
    const res = await POST(postRequest({ year: 2026, month: 0 }));
    expect(res.status).toBe(400);
  });

  it("responde 409 si el mes ya fue cerrado, sin iniciar la transacción", async () => {
    monthClosureFindUnique.mockResolvedValue({ id: "closure-1", cutoffDate: new Date(Date.UTC(2026, 5, 30)), closureType: "NORMAL" });
    taskFindMany.mockResolvedValue([]);
    taskCount.mockResolvedValue(0);

    const res = await POST(postRequest({ year: 2026, month: 6 }));
    expect(res.status).toBe(409);
    expect($transaction).not.toHaveBeenCalled();
  });

  it("archiva las tareas candidatas, crea el MonthClosure con el resumen correcto y no duplica tareas no recurrentes", async () => {
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([
      {
        id: "t1",
        title: "Tarea única",
        description: null,
        status: "COMPLETADA",
        priority: "MEDIA",
        frequency: "UNICA",
        type: "FIJA",
        startDate: new Date(Date.UTC(2026, 5, 1)),
        endDate: new Date(Date.UTC(2026, 5, 15)),
        estimatedHours: 5,
        assignedToId: "user-1",
        createdById: "user-1",
        color: null,
      },
    ]);
    taskCount.mockResolvedValue(0);
    monthClosureCreate.mockResolvedValue({ id: "closure-new" });
    taskUpdateMany.mockResolvedValue({ count: 1 });

    const res = await POST(postRequest({ year: 2026, month: 6 }));
    expect(res.status).toBe(200);

    expect(monthClosureCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          month: 6,
          year: 2026,
          closedBy: "u1",
          totalTasks: 1,
          completedTasks: 1,
          summary: { total: 1, completed: 1, pending: 0, inProgress: 0, duplicated: 0, continuedActive: 0 },
        }),
      })
    );
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1"] } },
      data: { archivedMonth: "2026-06", archivedAt: expect.any(Date) },
    });
    expect(taskCreateMany).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body).toMatchObject({ archivedCount: 1, duplicatedCount: 0, continuedActiveCount: 0, month: 6, year: 2026, nextMonth: 7, nextYear: 2026 });
  });

  it("duplica tareas recurrentes al mes siguiente, desplazando startDate/endDate y reiniciando estado/horas/progreso", async () => {
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([
      {
        id: "t-recurrente",
        title: "Reporte mensual",
        description: "desc",
        status: "COMPLETADA",
        priority: "ALTA",
        frequency: "MENSUAL",
        type: "FIJA",
        startDate: new Date(Date.UTC(2026, 0, 31)), // 31 de enero
        endDate: new Date(Date.UTC(2026, 0, 31)),
        estimatedHours: 8,
        assignedToId: "user-1",
        createdById: "user-2",
        color: "#fff",
      },
    ]);
    taskCount.mockResolvedValue(0);
    monthClosureCreate.mockResolvedValue({ id: "closure-new" });
    taskUpdateMany.mockResolvedValue({ count: 1 });
    taskCreateMany.mockResolvedValue({ count: 1 });

    const res = await POST(postRequest({ year: 2026, month: 1 }));
    expect(res.status).toBe(200);

    expect(taskCreateMany).toHaveBeenCalledTimes(1);
    const duplicated = taskCreateMany.mock.calls[0][0].data[0];
    expect(duplicated.title).toBe("Reporte mensual");
    expect(duplicated.status).toBe("PENDIENTE");
    expect(duplicated.realHours).toBe(0);
    expect(duplicated.progress).toBe(0);
    // Enero (31 días) -> Febrero 2026 (28 días, no bisiesto): el día se recorta al último día válido.
    expect(duplicated.startDate.toISOString()).toBe(new Date(Date.UTC(2026, 1, 28)).toISOString());
    expect(duplicated.endDate.toISOString()).toBe(new Date(Date.UTC(2026, 1, 28)).toISOString());

    const body = await res.json();
    expect(body.duplicatedCount).toBe(1);
  });

  it("no duplica tareas SEGUIMIENTO en curso (solo se archivan; las recurrentes no aplican a este tipo del mismo modo)", async () => {
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([
      {
        id: "t-seg",
        title: "Seguimiento completado",
        description: null,
        status: "COMPLETADA",
        priority: "BAJA",
        frequency: "UNICA",
        type: "SEGUIMIENTO",
        startDate: new Date(Date.UTC(2026, 5, 1)),
        endDate: new Date(Date.UTC(2026, 5, 10)),
        estimatedHours: 2,
        assignedToId: "user-1",
        createdById: "user-1",
        color: null,
      },
    ]);
    taskCount.mockResolvedValue(2); // otras SEGUIMIENTO en PENDIENTE/EN_PROGRESO siguen activas
    monthClosureCreate.mockResolvedValue({ id: "closure-new" });
    taskUpdateMany.mockResolvedValue({ count: 1 });

    const res = await POST(postRequest({ year: 2026, month: 6 }));
    const body = await res.json();
    expect(body.archivedCount).toBe(1);
    expect(body.continuedActiveCount).toBe(2);
    expect(taskCreateMany).not.toHaveBeenCalled();
  });

  it("persiste cutoffDate/closureType/días-horas considerados en el MonthClosure cuando se cierra con un corte anticipado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 15))); // 15 jul 2026 — dentro del propio mes de julio
    monthClosureFindUnique.mockResolvedValue(null);
    taskFindMany.mockResolvedValue([]);
    taskCount.mockResolvedValue(0);
    monthClosureCreate.mockResolvedValue({ id: "closure-new" });
    taskUpdateMany.mockResolvedValue({ count: 0 });

    const res = await POST(postRequest({ year: 2026, month: 7, cutoffDate: "2026-07-10" }));
    expect(res.status).toBe(200);

    expect(monthClosureCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          month: 7,
          year: 2026,
          cutoffDate: new Date(Date.UTC(2026, 6, 10)),
          closureType: "EARLY",
          calendarDaysTotal: 31,
          calendarDaysConsidered: 10,
        }),
      })
    );
    // El archivado de tareas sigue anclado al fin de mes calendario NATURAL,
    // no al corte — la Fecha de Corte solo acota la ventana de cálculo.
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ endDate: { lt: new Date(Date.UTC(2026, 7, 1)) } }) })
    );

    const body = await res.json();
    expect(body).toMatchObject({ cutoffDate: "2026-07-10", closureType: "EARLY", calendarDaysTotal: 31, calendarDaysConsidered: 10 });
  });
});
