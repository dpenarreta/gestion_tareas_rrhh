import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RETRY_DELAYS_MS,
  deadlineError,
  isRetryable,
  pendingStore,
  retryDelay,
  type DeadlineRules,
} from "@/lib/novedadesAutosave";

// Piezas del guardado automático de Novedades (ver docs/CHANGELOG.md § v1.174.0).

const RULES: DeadlineRules = {
  today: "2026-10-12",
  canBypassDeadline: false,
  workedDays: { hours: 48, earliestOpenDate: "2026-10-08" },
  overtime: { hours: 48, earliestOpenDate: "2026-10-08" },
};

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("reintentos", () => {
  it("solo reintenta fallos transitorios, nunca rechazos de reglas", () => {
    for (const s of [0, 408, 429, 500, 502, 503, 504]) expect(isRetryable(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 409]) expect(isRetryable(s)).toBe(false);
  });

  it("espera escalonada con tope (sin ciclos infinitos ni ráfagas)", () => {
    expect(retryDelay(0)).toBe(2000);
    expect(retryDelay(3)).toBe(30000);
    expect(retryDelay(99)).toBe(RETRY_DELAYS_MS.at(-1));
  });
});

describe("plazo por fecha", () => {
  it("rechaza fechas futuras para todos y vencidas solo sin excepción", () => {
    expect(deadlineError("2026-10-13", RULES, "workedDays")).toMatch(/futura/);
    expect(deadlineError("2026-10-13", { ...RULES, canBypassDeadline: true }, "overtime")).toMatch(/futura/);
    expect(deadlineError("2026-10-07", RULES, "workedDays")).toMatch(/venció/);
    expect(deadlineError("2026-10-07", { ...RULES, canBypassDeadline: true }, "workedDays")).toBeNull();
    expect(deadlineError("2026-10-08", RULES, "overtime")).toBeNull();
    expect(deadlineError("2026-10-12", RULES, "overtime")).toBeNull();
  });
});

describe("respaldo local de pendientes", () => {
  it("guarda, recupera y borra; caduca a los 7 días", () => {
    const store = pendingStore<{ a: string }>("test|1");
    expect(store.load()).toBeNull();
    store.save({ a: "8" });
    expect(store.load()).toEqual({ a: "8" });
    store.clear();
    expect(store.load()).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    store.save({ a: "viejo" });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    expect(store.load()).toBeNull();
  });

  it("no rompe la pantalla si el almacenamiento está bloqueado", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => pendingStore("x").save({})).not.toThrow();
    spy.mockRestore();
  });
});
