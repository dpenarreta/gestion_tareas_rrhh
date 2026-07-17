import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: vi.fn().mockResolvedValue([]) },
    taskActivity: { findMany: vi.fn().mockResolvedValue([]) },
    holiday: { findMany: vi.fn().mockResolvedValue([]) },
    leaveRecord: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/systemConfig", () => ({
  getEffectiveHorasEfectivas: vi.fn().mockResolvedValue(6.5),
  getEffectiveWorkloadLimitLow: vi.fn().mockResolvedValue(5.5),
  getEffectiveWorkloadLimitHigh: vi.fn().mockResolvedValue(7.5),
  getEffectiveWorkloadLimitOverload: vi.fn().mockResolvedValue(8.5),
}));

const { computeCargaTiempo } = await import("@/lib/workload");
const { prisma } = await import("@/lib/prisma");

// Sábado 2024-01-06 al mediodía UTC; el desplazamiento de -5h de la zona de
// negocio lo mantiene en sábado, por lo que el día calendario de negocio
// también cae en fin de semana.
const SATURDAY_NOON_UTC = new Date("2024-01-06T12:00:00Z");
// Domingo 2024-01-07.
const SUNDAY_NOON_UTC = new Date("2024-01-07T12:00:00Z");
// Miércoles 2024-01-10 como control (día hábil).
const WEDNESDAY_NOON_UTC = new Date("2024-01-10T12:00:00Z");

describe("computeCargaTiempo — fin de semana", () => {
  it("un sábado, la métrica diaria no aplica el semáforo (isWeekend=true, base=0, Óptimo)", async () => {
    const result = await computeCargaTiempo("user-1", SATURDAY_NOON_UTC);
    expect(result.diaria.isWeekend).toBe(true);
    expect(result.diaria.baseHours).toBe(0);
    expect(result.diaria.label).toBe("Óptimo");
    expect(result.diaria.color).toBe("green");
  });

  it("un domingo, la métrica diaria tampoco aplica el semáforo", async () => {
    const result = await computeCargaTiempo("user-1", SUNDAY_NOON_UTC);
    expect(result.diaria.isWeekend).toBe(true);
    expect(result.diaria.baseHours).toBe(0);
    expect(result.diaria.label).toBe("Óptimo");
  });

  it("en un día hábil normal, la métrica diaria sí aplica el semáforo (isWeekend=false)", async () => {
    const result = await computeCargaTiempo("user-1", WEDNESDAY_NOON_UTC);
    expect(result.diaria.isWeekend).toBe(false);
    expect(result.diaria.isHoliday).toBe(false);
    expect(result.diaria.baseHours).toBe(6.5);
  });
});

describe("computeCargaTiempo — feriados", () => {
  it("un feriado que cae en día hábil (miércoles) se trata como no laborable (isHoliday=true, base=0)", async () => {
    vi.mocked(prisma.holiday.findMany).mockResolvedValueOnce([
      { date: new Date(Date.UTC(2024, 0, 10)) },
    ] as never);
    const result = await computeCargaTiempo("user-1", WEDNESDAY_NOON_UTC);
    expect(result.diaria.isHoliday).toBe(true);
    expect(result.diaria.isWeekend).toBe(false);
    expect(result.diaria.baseHours).toBe(0);
    expect(result.diaria.label).toBe("Óptimo");
  });
});

describe("computeCargaTiempo — permisos", () => {
  it("un permiso médico de día completo reduce la base diaria a 0 sin marcar Subutilización", async () => {
    vi.mocked(prisma.leaveRecord.findMany).mockResolvedValueOnce([
      {
        userId: "user-1",
        type: "MEDICO",
        date: new Date(Date.UTC(2024, 0, 10)),
        isFullDay: true,
        durationMinutes: null,
      },
    ] as never);
    const result = await computeCargaTiempo("user-1", WEDNESDAY_NOON_UTC);
    expect(result.diaria.medicoLeaveFullDay).toBe(true);
    expect(result.diaria.baseHours).toBe(0);
    expect(result.diaria.label).toBe("Óptimo");
    expect(result.diaria.color).toBe("green");
  });

  it("un permiso personal parcial (3h de 6.5h) reduce proporcionalmente base y límites del día", async () => {
    vi.mocked(prisma.leaveRecord.findMany).mockResolvedValueOnce([
      {
        userId: "user-1",
        type: "PERSONAL",
        date: new Date(Date.UTC(2024, 0, 10)),
        isFullDay: false,
        durationMinutes: 180,
      },
    ] as never);
    const result = await computeCargaTiempo("user-1", WEDNESDAY_NOON_UTC);
    expect(result.diaria.personalLeaveMinutes).toBe(180);
    // factor = 1 - 3/6.5 ≈ 0.5385 → base ≈ 3.5h
    expect(result.diaria.baseHours).toBeCloseTo(3.5, 1);
  });
});
