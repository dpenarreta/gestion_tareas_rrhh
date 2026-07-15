import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: vi.fn().mockResolvedValue([]) },
    taskActivity: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/systemConfig", () => ({
  getEffectiveHorasEfectivas: vi.fn().mockResolvedValue(6.5),
  getEffectiveWorkloadLimitLow: vi.fn().mockResolvedValue(5.5),
  getEffectiveWorkloadLimitHigh: vi.fn().mockResolvedValue(7.5),
  getEffectiveWorkloadLimitOverload: vi.fn().mockResolvedValue(8.5),
}));

const { computeCargaTiempo } = await import("@/lib/workload");

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
    expect(result.diaria.baseHours).toBe(6.5);
  });
});
