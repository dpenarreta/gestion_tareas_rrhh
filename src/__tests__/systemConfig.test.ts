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
  getEffectiveRetroactiveWindowDays,
  DEFAULT_RETROACTIVE_WINDOW_DAYS,
  CONFIG_KEY_RETROACTIVE_WINDOW_DAYS,
  getEffectiveWorkdayEndHour,
  DEFAULT_WORKDAY_END_HOUR,
  CONFIG_KEY_WORKDAY_END_HOUR,
  getEffectiveDeskArchiveRetentionDays,
  DEFAULT_DESK_ARCHIVE_RETENTION_DAYS,
  CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS,
  getEffectiveDeskNoteMaxReplies,
  DEFAULT_DESK_NOTE_MAX_REPLIES,
  CONFIG_KEY_DESK_NOTE_MAX_REPLIES,
  getEffectiveSnoozePresetsMinutes,
  DEFAULT_SNOOZE_PRESETS_MINUTES,
  CONFIG_KEY_SNOOZE_PRESETS_MINUTES,
  getEffectiveNovaCacheTtlMinutes,
  DEFAULT_NOVA_CACHE_TTL_MINUTES,
  CONFIG_KEY_NOVA_CACHE_TTL_MINUTES,
  getEffectivePasswordMinLength,
  DEFAULT_PASSWORD_MIN_LENGTH,
  CONFIG_KEY_PASSWORD_MIN_LENGTH,
  getEffectiveSessionDurationDefaultHours,
  DEFAULT_SESSION_DURATION_DEFAULT_HOURS,
  CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS,
  getEffectiveSessionDurationRememberHours,
  DEFAULT_SESSION_DURATION_REMEMBER_HOURS,
  CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS,
  getEffectiveRetentionLoginAttempts,
  DEFAULT_RETENTION_LOGIN_ATTEMPTS,
  CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS,
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

// ── Sprint O — Centro de Configuración NEXO: 9 parámetros nuevos ────────────
// Mismo patrón que getEffectiveHorasEfectivas — cada uno solo necesita
// confirmar la clave correcta y el fallback al valor por defecto documentado.

describe("getEffectiveRetroactiveWindowDays", () => {
  beforeEach(() => findFirst.mockReset());
  it("usa la clave y el valor por defecto correctos", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveRetroactiveWindowDays()).toBe(DEFAULT_RETROACTIVE_WINDOW_DAYS);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_RETROACTIVE_WINDOW_DAYS }) })
    );
  });
  it("devuelve el valor configurado cuando existe un registro", async () => {
    findFirst.mockResolvedValue({ value: "3" });
    expect(await getEffectiveRetroactiveWindowDays()).toBe(3);
  });
});

describe("getEffectiveWorkdayEndHour", () => {
  beforeEach(() => findFirst.mockReset());
  it("usa la clave y el valor por defecto correctos", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveWorkdayEndHour()).toBe(DEFAULT_WORKDAY_END_HOUR);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_WORKDAY_END_HOUR }) })
    );
  });
});

describe("getEffectiveDeskArchiveRetentionDays", () => {
  beforeEach(() => findFirst.mockReset());
  it("usa la clave y el valor por defecto correctos", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveDeskArchiveRetentionDays()).toBe(DEFAULT_DESK_ARCHIVE_RETENTION_DAYS);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_DESK_ARCHIVE_RETENTION_DAYS }) })
    );
  });
});

describe("getEffectiveDeskNoteMaxReplies", () => {
  beforeEach(() => findFirst.mockReset());
  it("usa la clave y el valor por defecto correctos", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveDeskNoteMaxReplies()).toBe(DEFAULT_DESK_NOTE_MAX_REPLIES);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_DESK_NOTE_MAX_REPLIES }) })
    );
  });
});

describe("getEffectiveSnoozePresetsMinutes", () => {
  beforeEach(() => findFirst.mockReset());
  it("sin registro, devuelve los presets por defecto", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveSnoozePresetsMinutes()).toEqual(DEFAULT_SNOOZE_PRESETS_MINUTES);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_SNOOZE_PRESETS_MINUTES }) })
    );
  });
  it("devuelve el array configurado (JSON) cuando existe un registro válido", async () => {
    findFirst.mockResolvedValue({ value: "[10,20]" });
    expect(await getEffectiveSnoozePresetsMinutes()).toEqual([10, 20]);
  });
  it("cae a los presets por defecto si el JSON guardado es inválido", async () => {
    findFirst.mockResolvedValue({ value: "no-es-json" });
    expect(await getEffectiveSnoozePresetsMinutes()).toEqual(DEFAULT_SNOOZE_PRESETS_MINUTES);
  });
});

describe("getEffectiveNovaCacheTtlMinutes", () => {
  beforeEach(() => findFirst.mockReset());
  it("usa la clave y el valor por defecto correctos", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveNovaCacheTtlMinutes()).toBe(DEFAULT_NOVA_CACHE_TTL_MINUTES);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_NOVA_CACHE_TTL_MINUTES }) })
    );
  });
});

describe("getEffectivePasswordMinLength", () => {
  beforeEach(() => findFirst.mockReset());
  it("usa la clave y el valor por defecto correctos", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectivePasswordMinLength()).toBe(DEFAULT_PASSWORD_MIN_LENGTH);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_PASSWORD_MIN_LENGTH }) })
    );
  });
});

describe("getEffectiveSessionDurationDefaultHours / getEffectiveSessionDurationRememberHours", () => {
  beforeEach(() => findFirst.mockReset());
  it("usan sus claves y valores por defecto correctos (7d / 30d)", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveSessionDurationDefaultHours()).toBe(DEFAULT_SESSION_DURATION_DEFAULT_HOURS);
    expect(await getEffectiveSessionDurationRememberHours()).toBe(DEFAULT_SESSION_DURATION_REMEMBER_HOURS);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS }) })
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS }) })
    );
  });
});

describe("getEffectiveRetentionLoginAttempts", () => {
  beforeEach(() => findFirst.mockReset());
  it("usa la clave y el valor por defecto correctos", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getEffectiveRetentionLoginAttempts()).toBe(DEFAULT_RETENTION_LOGIN_ATTEMPTS);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ key: CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS }) })
    );
  });
});
