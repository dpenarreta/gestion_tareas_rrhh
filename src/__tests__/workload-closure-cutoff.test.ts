import { describe, expect, it, vi } from "vitest";

const fetchDjangoMonthClosure = vi.fn();

vi.mock("@/lib/djangoClosurePeriodAdapter", () => ({
  fetchDjangoMonthClosure: (...a: unknown[]) => fetchDjangoMonthClosure(...a),
}));

vi.mock("@/lib/djangoHolidaysAdapter", () => ({
  fetchDjangoHolidaySet: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock("@/lib/systemConfig", () => ({
  getEffectiveHorasEfectivas: vi.fn().mockResolvedValue(6.5),
  getEffectiveWorkloadLimitLow: vi.fn().mockResolvedValue(5.5),
  getEffectiveWorkloadLimitHigh: vi.fn().mockResolvedValue(7.5),
  getEffectiveWorkloadLimitOverload: vi.fn().mockResolvedValue(8.5),
}));

const { monthlyBusinessBase } = await import("@/lib/workload");

describe("monthlyBusinessBase — Motor de Cierre Inteligente con Fecha de Corte", () => {
  it("sin MonthClosure para el mes, se comporta exactamente igual que antes (fin de mes calendario completo)", async () => {
    fetchDjangoMonthClosure.mockResolvedValue(null);
    // Julio 2026: lun-vie del 1 al 31 = 23 días hábiles (1 jul es miércoles).
    const biz = await monthlyBusinessBase(2026, 7);
    expect(biz.end).toEqual(new Date(Date.UTC(2026, 6, 31, 23, 59, 59, 999)));
    expect(biz.businessDays).toBe(23);
    expect(biz.baseHours).toBeCloseTo(23 * 6.5, 5);
  });

  it("con un MonthClosure cerrado en el último día (closureType NORMAL), el resultado es idéntico al de un mes sin cierre", async () => {
    fetchDjangoMonthClosure.mockResolvedValue({
      cutoffDate: new Date(Date.UTC(2026, 6, 31)),
      closureType: "NORMAL",
    });
    const biz = await monthlyBusinessBase(2026, 7);
    expect(biz.businessDays).toBe(23);
    expect(biz.baseHours).toBeCloseTo(23 * 6.5, 5);
  });

  it("con un MonthClosure de corte anticipado, trunca días hábiles y horas base al día de corte", async () => {
    // Corte el 28 de julio de 2026 (martes) — días hábiles jul 1..28: 20 días hábiles.
    fetchDjangoMonthClosure.mockResolvedValue({
      cutoffDate: new Date(Date.UTC(2026, 6, 28)),
      closureType: "MANUAL",
    });
    const biz = await monthlyBusinessBase(2026, 7);
    expect(biz.businessDays).toBe(20);
    expect(biz.baseHours).toBeCloseTo(20 * 6.5, 5);
    expect(biz.end).toEqual(new Date(Date.UTC(2026, 6, 28)));
  });

  it("consulta el cierre exactamente por (year, month) del mes pedido", async () => {
    fetchDjangoMonthClosure.mockResolvedValue(null);
    await monthlyBusinessBase(2026, 7);
    expect(fetchDjangoMonthClosure).toHaveBeenCalledWith(2026, 7);
  });
});
