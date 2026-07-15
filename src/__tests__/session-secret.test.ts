import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// session-secret.ts valida y exporta SESSION_SECRET al importarse (fail-closed:
// lanza si falta o es demasiado corto). Cada test necesita módulos frescos
// (vi.resetModules) para que la validación se re-evalúe con el env manipulado.
const ORIGINAL_SECRET = process.env.SESSION_SECRET;

describe("session-secret", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = ORIGINAL_SECRET;
    vi.resetModules();
  });

  it("lanza si SESSION_SECRET no está definido", async () => {
    delete process.env.SESSION_SECRET;
    await expect(import("@/lib/session-secret")).rejects.toThrow(/no está configurado/);
  });

  it("lanza si SESSION_SECRET tiene menos de 32 caracteres", async () => {
    process.env.SESSION_SECRET = "demasiado-corto";
    await expect(import("@/lib/session-secret")).rejects.toThrow(/demasiado corto/);
  });

  it("exporta el valor si tiene 32 caracteres o más (fail-closed superado)", async () => {
    const valid = "a".repeat(32);
    process.env.SESSION_SECRET = valid;
    const mod = await import("@/lib/session-secret");
    expect(mod.SESSION_SECRET).toBe(valid);
  });

  it("acepta exactamente 32 caracteres (límite inclusive)", async () => {
    const exact = "b".repeat(32);
    process.env.SESSION_SECRET = exact;
    const mod = await import("@/lib/session-secret");
    expect(mod.SESSION_SECRET).toHaveLength(32);
  });
});
