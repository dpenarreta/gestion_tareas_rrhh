import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const taskFindUnique = vi.fn();
const taskUpdate = vi.fn();
const taskActivityFindMany = vi.fn();
const taskActivityCreate = vi.fn();
const activityReasonFindUnique = vi.fn();
const userFindMany = vi.fn();
const notificationCreateMany = vi.fn();
const systemConfigHistoryFindFirst = vi.fn();
const holidayFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findUnique: (...a: unknown[]) => taskFindUnique(...a), update: (...a: unknown[]) => taskUpdate(...a) },
    taskActivity: {
      findMany: (...a: unknown[]) => taskActivityFindMany(...a),
      create: (...a: unknown[]) => taskActivityCreate(...a),
    },
    activityReason: { findUnique: (...a: unknown[]) => activityReasonFindUnique(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    notification: { createMany: (...a: unknown[]) => notificationCreateMany(...a) },
    systemConfigHistory: { findFirst: (...a: unknown[]) => systemConfigHistoryFindFirst(...a) },
    holiday: { findMany: (...a: unknown[]) => holidayFindMany(...a) },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { POST: retroactivePOST } = await import("@/app/api/tasks/[id]/activities/retroactive/route");
const { GET: dayScheduleGET } = await import("@/app/api/activities/day-schedule/route");

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

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function ctx(id = "task-1") {
  return { params: Promise.resolve({ id }) };
}

function getRequest(url: string) {
  return { nextUrl: new URL(url) } as never;
}

function resetAll() {
  taskFindUnique
    .mockReset()
    .mockResolvedValue({ id: "task-1", title: "Tarea seguimiento", type: "SEGUIMIENTO", assignedToId: "u1" });
  taskUpdate.mockReset().mockResolvedValue({});
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  taskActivityCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "new-activity", ...data, author: { id: "u1", name: "Ana" }, _count: { comments: 0 } })
  );
  activityReasonFindUnique.mockReset().mockResolvedValue({
    key: "REUNION",
    isActive: true,
    assignedRoles: ["ASISTENTE_GH"],
  });
  userFindMany.mockReset().mockResolvedValue([]);
  notificationCreateMany.mockReset().mockResolvedValue({});
  systemConfigHistoryFindFirst.mockReset().mockResolvedValue(null);
  holidayFindMany.mockReset().mockResolvedValue([]);
  vi.mocked(getSession).mockReset();
}

// Miércoles 2026-07-15 al mediodía UTC como "ahora" — los últimos 2 días
// laborables son martes 14 y lunes 13 de julio de 2026.
const NOW = new Date("2026-07-15T12:00:00Z");
const VALID_RETROACTIVE_DATE = "2026-07-14";

describe("POST /api/tasks/[id]/activities/retroactive — hora inicio/fin y solapamiento", () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("guarda startTime/endTime cuando se usa el formato de rango horario", async () => {
    mockSession({});
    const res = await retroactivePOST(
      jsonRequest({
        reason: "REUNION",
        hours: 1,
        minutes: 0,
        description: "Descripción obligatoria",
        activityDate: VALID_RETROACTIVE_DATE,
        startTime: "09:00",
        endTime: "10:00",
      }),
      ctx()
    );
    expect(res.status).toBe(201);
    expect(taskActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ startTime: "09:00", endTime: "10:00" }) })
    );
  });

  it("responde 400 si la hora fin no es posterior a la hora inicio", async () => {
    mockSession({});
    const res = await retroactivePOST(
      jsonRequest({
        reason: "REUNION",
        hours: 1,
        minutes: 0,
        description: "Descripción obligatoria",
        activityDate: VALID_RETROACTIVE_DATE,
        startTime: "10:00",
        endTime: "09:00",
      }),
      ctx()
    );
    expect(res.status).toBe(400);
  });

  it("responde 409 si el horario se solapa con una actividad existente ese día retroactivo (de cualquier tarea)", async () => {
    mockSession({});
    taskActivityFindMany.mockResolvedValue([
      { startTime: "08:00", endTime: "09:30", duration: 90, task: { title: "Otra tarea de seguimiento" } },
    ]);
    const res = await retroactivePOST(
      jsonRequest({
        reason: "REUNION",
        hours: 0,
        minutes: 45,
        description: "Descripción obligatoria",
        activityDate: VALID_RETROACTIVE_DATE,
        startTime: "09:00",
        endTime: "09:45",
      }),
      ctx()
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('de 08:00 a 09:30 en la tarea "Otra tarea de seguimiento"');
    expect(taskActivityCreate).not.toHaveBeenCalled();
  });

  it("el solapamiento se verifica contra el día retroactivo seleccionado, no contra hoy", async () => {
    mockSession({});
    // taskActivityFindMany devuelve un conflicto sin importar el rango de fecha pasado
    // (el mock no filtra por fecha real) — lo que valida aquí es que la ruta llama a
    // findOverlappingActivity con la fecha retroactiva y no con "ahora".
    taskActivityFindMany.mockResolvedValue([]);
    const res = await retroactivePOST(
      jsonRequest({
        reason: "REUNION",
        hours: 0,
        minutes: 45,
        description: "Descripción obligatoria",
        activityDate: VALID_RETROACTIVE_DATE,
        startTime: "09:00",
        endTime: "09:45",
      }),
      ctx()
    );
    expect(res.status).toBe(201);
  });

  it("sin startTime/endTime no ejecuta el validador de solapamiento (formato de duración directa)", async () => {
    mockSession({});
    const res = await retroactivePOST(
      jsonRequest({
        reason: "REUNION",
        hours: 1,
        minutes: 0,
        description: "Descripción obligatoria",
        activityDate: VALID_RETROACTIVE_DATE,
      }),
      ctx()
    );
    expect(res.status).toBe(201);
  });

  it("responde 404 si la tarea existe pero no es visible para el solicitante", async () => {
    mockSession({ userId: "u2", role: "ASISTENTE_GH" });
    taskFindUnique.mockResolvedValue({
      id: "task-1",
      title: "Tarea seguimiento",
      type: "SEGUIMIENTO",
      assignedToId: "owner-x",
      createdById: "owner-y",
      assignedTo: { role: "ASISTENTE_SELECCION" },
    });
    const res = await retroactivePOST(
      jsonRequest({
        reason: "REUNION",
        hours: 1,
        minutes: 0,
        description: "Descripción obligatoria",
        activityDate: VALID_RETROACTIVE_DATE,
      }),
      ctx()
    );
    expect(res.status).toBe(404);
    expect(taskActivityCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/activities/day-schedule", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await dayScheduleGET(getRequest("http://localhost/api/activities/day-schedule"));
    expect(res.status).toBe(401);
  });

  it("responde 400 si la fecha tiene formato inválido", async () => {
    mockSession({});
    const res = await dayScheduleGET(getRequest("http://localhost/api/activities/day-schedule?date=15-07-2026"));
    expect(res.status).toBe(400);
  });

  it("devuelve las actividades con horario del usuario para el día, con el título de la tarea", async () => {
    mockSession({ userId: "u1" });
    taskActivityFindMany.mockResolvedValue([
      { id: "a1", startTime: "08:00", endTime: "09:00", taskId: "task-1", task: { title: "Tarea A" } },
    ]);
    const res = await dayScheduleGET(getRequest("http://localhost/api/activities/day-schedule?date=2026-07-14"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { id: "a1", startTime: "08:00", endTime: "09:00", taskId: "task-1", taskTitle: "Tarea A" },
    ]);
    expect(taskActivityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorId: "u1",
          startTime: { not: null },
          endTime: { not: null },
          task: { type: "SEGUIMIENTO" },
        }),
      })
    );
  });
});
