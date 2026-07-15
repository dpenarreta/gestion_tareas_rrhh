import { describe, expect, it, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const upsert = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loginAttempt: { findUnique, upsert, update, deleteMany },
  },
}));

const { isRateLimited, getBlockedMinutesRemaining, registerFailedAttempt, clearAttempts, getClientIp } = await import(
  "@/lib/rate-limit"
);

describe("isRateLimited", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("no está limitada si no hay registro previo", async () => {
    findUnique.mockResolvedValue(null);
    expect(await isRateLimited("1.2.3.4")).toBe(false);
  });

  it("está limitada con 5+ intentos y bloqueo vigente en el futuro", async () => {
    findUnique.mockResolvedValue({ attempts: 5, blockedUntil: new Date(Date.now() + 60_000) });
    expect(await isRateLimited("1.2.3.4")).toBe(true);
  });

  it("no está limitada si el bloqueo ya expiró", async () => {
    findUnique.mockResolvedValue({ attempts: 5, blockedUntil: new Date(Date.now() - 60_000) });
    expect(await isRateLimited("1.2.3.4")).toBe(false);
  });

  it("no está limitada con menos de 5 intentos, aunque haya un blockedUntil", () => {
    findUnique.mockResolvedValue({ attempts: 3, blockedUntil: new Date(Date.now() + 60_000) });
    return expect(isRateLimited("1.2.3.4")).resolves.toBe(false);
  });
});

describe("getBlockedMinutesRemaining", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("devuelve 0 sin registro", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getBlockedMinutesRemaining("1.2.3.4")).toBe(0);
  });

  it("devuelve 0 si blockedUntil es null", async () => {
    findUnique.mockResolvedValue({ blockedUntil: null });
    expect(await getBlockedMinutesRemaining("1.2.3.4")).toBe(0);
  });

  it("redondea hacia arriba los minutos restantes", async () => {
    findUnique.mockResolvedValue({ blockedUntil: new Date(Date.now() + 5 * 60_000 + 1000) });
    expect(await getBlockedMinutesRemaining("1.2.3.4")).toBe(6);
  });

  it("devuelve 0 si el bloqueo ya expiró", async () => {
    findUnique.mockResolvedValue({ blockedUntil: new Date(Date.now() - 1000) });
    expect(await getBlockedMinutesRemaining("1.2.3.4")).toBe(0);
  });
});

describe("registerFailedAttempt", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    update.mockReset();
  });

  it("sin registro previo, hace upsert con attempts=1 y sin bloqueo", async () => {
    findUnique.mockResolvedValue(null);
    await registerFailedAttempt("1.2.3.4");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ip: "1.2.3.4" },
        create: expect.objectContaining({ attempts: 1, blockedUntil: null }),
        update: expect.objectContaining({ attempts: 1, blockedUntil: null }),
      })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("con un bloqueo ya expirado, reinicia el conteo a 1 (vía upsert)", async () => {
    findUnique.mockResolvedValue({ attempts: 5, blockedUntil: new Date(Date.now() - 1000) });
    await registerFailedAttempt("1.2.3.4");
    expect(upsert).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("incrementa attempts sin activar bloqueo si aún no llega a 5", async () => {
    findUnique.mockResolvedValue({ attempts: 2, blockedUntil: null });
    await registerFailedAttempt("1.2.3.4");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ip: "1.2.3.4" },
        data: expect.objectContaining({ attempts: 3, blockedUntil: null }),
      })
    );
  });

  it("activa un bloqueo de ~15 minutos al llegar al 5to intento", async () => {
    findUnique.mockResolvedValue({ attempts: 4, blockedUntil: null });
    const before = Date.now();
    await registerFailedAttempt("1.2.3.4");
    const call = update.mock.calls[0][0];
    expect(call.data.attempts).toBe(5);
    const blockedUntil: Date = call.data.blockedUntil;
    expect(blockedUntil.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1000);
    expect(blockedUntil.getTime()).toBeLessThanOrEqual(before + 15 * 60_000 + 5000);
  });

  it("si se llama de nuevo mientras ya está bloqueada (fuera del flujo normal, que lo impide vía isRateLimited), extiende el bloqueo otros ~15 minutos desde ahora en vez de preservar el anterior", async () => {
    const existingBlock = new Date(Date.now() + 10 * 60_000);
    findUnique.mockResolvedValue({ attempts: 5, blockedUntil: existingBlock });
    const before = Date.now();
    await registerFailedAttempt("1.2.3.4");
    const call = update.mock.calls[0][0];
    expect(call.data.attempts).toBe(6);
    const blockedUntil: Date = call.data.blockedUntil;
    expect(blockedUntil.getTime()).not.toBe(existingBlock.getTime());
    expect(blockedUntil.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1000);
  });
});

describe("clearAttempts", () => {
  it("elimina el registro de intentos de la IP", async () => {
    deleteMany.mockReset();
    await clearAttempts("1.2.3.4");
    expect(deleteMany).toHaveBeenCalledWith({ where: { ip: "1.2.3.4" } });
  });
});

describe("getClientIp", () => {
  it("usa la primera IP de x-forwarded-for, sin espacios", () => {
    const headers = new Headers({ "x-forwarded-for": " 9.9.9.9 , 8.8.8.8" });
    expect(getClientIp(headers)).toBe("9.9.9.9");
  });

  it("usa x-real-ip si no hay x-forwarded-for", () => {
    const headers = new Headers({ "x-real-ip": "7.7.7.7" });
    expect(getClientIp(headers)).toBe("7.7.7.7");
  });

  it("prioriza x-forwarded-for sobre x-real-ip cuando ambos están presentes", () => {
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" });
    expect(getClientIp(headers)).toBe("1.1.1.1");
  });

  it("devuelve 'unknown' si no hay ninguno de los dos headers", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
