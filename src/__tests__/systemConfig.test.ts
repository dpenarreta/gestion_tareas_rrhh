import { describe, expect, it, vi, beforeEach } from "vitest";

const findFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemConfigHistory: { findFirst },
  },
}));

const {
  getEffectiveConfigValue,
  getEffectiveConfigString,
  getEffectiveHorasEfectivas,
  DEFAULT_HORAS_EFECTIVAS,
  CONFIG_KEY_HORAS_EFECTIVAS,
} = await import("@/lib/systemConfig");

describe("getEffectiveConfigValue", () => {
  beforeEach(() => findFirst.mockReset());

  it("devuelve el fallback si no hay ningún registro histórico", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveConfigValue("some_key", new Date(), 42)).toBe(42);
  });

  it("devuelve el valor numérico parseado del registro vigente", async () => {
    findFirst.mockResolvedValue({ value: "7.25" });
    expect(await getEffectiveConfigValue("some_key", new Date(), 0)).toBe(7.25);
  });

  it("cae al fallback si el valor almacenado no es un número válido", async () => {
    findFirst.mockResolvedValue({ value: "no-es-un-numero" });
    expect(await getEffectiveConfigValue("some_key", new Date(), 9.9)).toBe(9.9);
  });

  it("consulta con el key y la fecha correctos (validFrom <= asOf, validUntil null o posterior)", async () => {
    findFirst.mockResolvedValue(null);
    const asOf = new Date("2026-01-01T00:00:00Z");
    await getEffectiveConfigValue("my_key", asOf, 0);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          key: "my_key",
          validFrom: { lte: asOf },
          OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
        },
        orderBy: { validFrom: "desc" },
      })
    );
  });
});

describe("getEffectiveConfigString", () => {
  beforeEach(() => findFirst.mockReset());

  it("devuelve el fallback si no hay registro histórico", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveConfigString("retention_key", new Date(), "24")).toBe("24");
  });

  it("devuelve el valor string tal cual, sin intentar parsearlo como número", async () => {
    findFirst.mockResolvedValue({ value: "indefinite" });
    expect(await getEffectiveConfigString("retention_key", new Date(), "24")).toBe("indefinite");
  });
});

describe("getEffectiveHorasEfectivas", () => {
  beforeEach(() => findFirst.mockReset());

  it("usa la clave y el valor por defecto correctos", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveHorasEfectivas()).toBe(DEFAULT_HORAS_EFECTIVAS);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_HORAS_EFECTIVAS }) })
    );
  });
});
