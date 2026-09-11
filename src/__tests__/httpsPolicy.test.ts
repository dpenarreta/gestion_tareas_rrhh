/**
 * Cobertura de `src/lib/httpsPolicy.ts` — la política de HTTPS del
 * despliegue (ver docs/AUDIT_LOG.md § 2026-09-08, "Despliegue por http en
 * red interna").
 *
 * Lo que importa acá es el sentido del default: si alguien invierte la
 * comparación, el sistema pasaría a servir cookies sin `secure` en cualquier
 * despliegue que no declare la variable — y eso no falla de forma visible,
 * simplemente deja la sesión viajando en claro.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

async function loadPolicy(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) {
    delete process.env.REQUIRE_HTTPS;
  } else {
    process.env.REQUIRE_HTTPS = value;
  }
  return (await import("@/lib/httpsPolicy")).requireHttps;
}

afterEach(() => {
  delete process.env.REQUIRE_HTTPS;
  vi.resetModules();
});

describe("requireHttps", () => {
  it("exige https cuando la variable no está declarada (seguro por defecto)", async () => {
    await expect(loadPolicy(undefined)).resolves.toBe(true);
  });

  it("solo un 'false' explícito desactiva la exigencia", async () => {
    await expect(loadPolicy("false")).resolves.toBe(false);
  });

  it("mantiene la exigencia ante cualquier otro valor", async () => {
    for (const value of ["true", "1", "0", "no", "", "False", " false"]) {
      await expect(loadPolicy(value)).resolves.toBe(true);
    }
  });
});
