import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: vi.fn().mockResolvedValue([]) },
    taskActivity: { findMany: vi.fn().mockResolvedValue([]) },
    holiday: { findMany: vi.fn().mockResolvedValue([]) },
    leaveRecord: { findMany: vi.fn().mockResolvedValue([]) },
    specialStatus: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn().mockResolvedValue({ kpiStartDate: null }) },
  },
}));

vi.mock("@/lib/systemConfig", () => ({
  getEffectiveHorasEfectivas: vi.fn().mockResolvedValue(6.5),
  getEffectiveWorkloadLimitLow: vi.fn().mockResolvedValue(5.5),
  getEffectiveWorkloadLimitHigh: vi.fn().mockResolvedValue(7.5),
  getEffectiveWorkloadLimitOverload: vi.fn().mockResolvedValue(8.5),
}));

const { computeCargaHistory, redactSensitiveWorkloadDetail } = await import("@/lib/workload");
const { prisma } = await import("@/lib/prisma");

// Miércoles 2024-01-10 al mediodía UTC — mes de enero 2024 (lunes 1 a miércoles 10
// hábiles: 1,2,3,4,5,8,9,10 = 8 días hábiles; 6 y 7 son fin de semana).
const WEDNESDAY_JAN_10 = new Date("2024-01-10T12:00:00Z");

describe("computeCargaHistory — rango mensual deslizable (daily)", () => {
  it("sin kpiStartDate, el rango diario va del día 1 del mes hasta hoy (nunca futuro)", async () => {
    const { daily } = await computeCargaHistory("user-1", WEDNESDAY_JAN_10);
    // Solo días hábiles con datos entran por defecto (sin horas ni permiso → "empty",
    // pero igual aparecen en el arreglo) — deben ser los 8 días hábiles de 1 a 10 ene.
    expect(daily).toHaveLength(8);
    expect(daily[0].date).toBe("2024-01-01");
    expect(daily[daily.length - 1].date).toBe("2024-01-10");
    expect(daily.every((d) => d.kind === "empty")).toBe(true);
  });

  it("con kpiStartDate a mitad de mes, el rango diario arranca en esa fecha", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      kpiStartDate: new Date(Date.UTC(2024, 0, 8)),
    } as never);
    const { daily } = await computeCargaHistory("user-1", WEDNESDAY_JAN_10);
    // 8, 9, 10 ene = 3 días hábiles.
    expect(daily).toHaveLength(3);
    expect(daily[0].date).toBe("2024-01-08");
  });

  it("un feriado dentro del rango aparece con kind 'holiday'", async () => {
    vi.mocked(prisma.holiday.findMany).mockResolvedValueOnce([
      { date: new Date(Date.UTC(2024, 0, 5)) },
    ] as never);
    const { daily } = await computeCargaHistory("user-1", WEDNESDAY_JAN_10);
    const holiday = daily.find((d) => d.date === "2024-01-05");
    expect(holiday?.kind).toBe("holiday");
  });

  it("un permiso médico de día completo aparece con kind 'leave-medico'", async () => {
    vi.mocked(prisma.leaveRecord.findMany).mockResolvedValueOnce([
      { userId: "user-1", type: "MEDICO", date: new Date(Date.UTC(2024, 0, 3)), isFullDay: true, durationMinutes: null },
    ] as never);
    const { daily } = await computeCargaHistory("user-1", WEDNESDAY_JAN_10);
    const day = daily.find((d) => d.date === "2024-01-03");
    expect(day?.kind).toBe("leave-medico");
  });

  it("vacaciones de día completo aparecen con kind 'leave-vacaciones'", async () => {
    vi.mocked(prisma.leaveRecord.findMany).mockResolvedValueOnce([
      { userId: "user-1", type: "VACACIONES", date: new Date(Date.UTC(2024, 0, 2)), isFullDay: true, durationMinutes: null },
    ] as never);
    const { daily } = await computeCargaHistory("user-1", WEDNESDAY_JAN_10);
    const day = daily.find((d) => d.date === "2024-01-02");
    expect(day?.kind).toBe("leave-vacaciones");
  });

  it("un fin de semana sin horas registradas no aparece; con horas registradas aparece como 'weekend-extra'", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValueOnce([
      {
        completedAt: new Date(Date.UTC(2024, 0, 6, 15)), // sábado 6 ene, dentro de la ventana de negocio del día
        realHours: 2,
      },
    ] as never);
    const { daily } = await computeCargaHistory("user-1", WEDNESDAY_JAN_10);
    const saturday = daily.find((d) => d.date === "2024-01-06");
    const sunday = daily.find((d) => d.date === "2024-01-07");
    expect(saturday?.kind).toBe("weekend-extra");
    expect(saturday?.realHours).toBe(2);
    expect(sunday).toBeUndefined();
  });

  it("nunca incluye días posteriores a 'hoy'", async () => {
    const { daily } = await computeCargaHistory("user-1", WEDNESDAY_JAN_10);
    expect(daily.every((d) => d.date <= "2024-01-10")).toBe(true);
  });
});

describe("redactSensitiveWorkloadDetail — histórico diario", () => {
  it("colapsa leave-medico/leave-personal/leave-vacaciones a 'leave-generic' y no toca 'normal'/'holiday'", async () => {
    vi.mocked(prisma.leaveRecord.findMany).mockResolvedValueOnce([
      { userId: "user-1", type: "MEDICO", date: new Date(Date.UTC(2024, 0, 3)), isFullDay: true, durationMinutes: null },
    ] as never);
    vi.mocked(prisma.holiday.findMany).mockResolvedValueOnce([
      { date: new Date(Date.UTC(2024, 0, 5)) },
    ] as never);
    const { daily, weekly } = await computeCargaHistory("user-1", WEDNESDAY_JAN_10);
    const cargaTiempoStub = {
      diaria: { medicoLeaveMinutes: 0, medicoLeaveFullDay: false, personalLeaveMinutes: 0, personalLeaveFullDay: false, vacacionesFullDay: false },
      mensual: { medicoLeaveMinutes: 0, personalLeaveMinutes: 0, vacacionesMinutes: 0 },
      semanal: {},
      dailyHistory: daily,
      weeklyHistory: weekly,
    };
    const redacted = redactSensitiveWorkloadDetail(cargaTiempoStub as never);
    const medicoDay = redacted.dailyHistory.find((d) => d.date === "2024-01-03");
    const holidayDay = redacted.dailyHistory.find((d) => d.date === "2024-01-05");
    expect(medicoDay?.kind).toBe("leave-generic");
    expect(holidayDay?.kind).toBe("holiday");
    expect(redacted.sensitiveDetailVisible).toBe(false);
  });
});
