import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Bug real reportado en producción (ver docs/AUDIT_LOG.md § 2026-09-11):
 * crear o borrar un usuario no cambiaba nada en la lista hasta refrescar la
 * página. La causa no estaba en el módulo de usuarios, sino en que las Route
 * Handlers de Next.js no emiten `Cache-Control`, así que el navegador
 * reutilizaba la respuesta anterior del GET.
 *
 * Este archivo fija ese encabezado. Sin él el síntoma vuelve, y vuelve en
 * TODOS los módulos a la vez, que es justamente lo difícil de diagnosticar.
 */

async function reglasDeHeaders() {
  if (typeof nextConfig.headers !== "function") {
    throw new Error("next.config.ts no define headers()");
  }
  return nextConfig.headers();
}

describe("next.config.ts — encabezados", () => {
  it("las rutas de API se declaran no cacheables", async () => {
    const reglas = await reglasDeHeaders();
    const api = reglas.find((r) => r.source === "/api/:path*");

    expect(api, "falta la regla para /api/:path*").toBeDefined();
    const cacheControl = api!.headers.find((h) => h.key === "Cache-Control");
    expect(cacheControl?.value).toContain("no-store");
  });

  it("los encabezados de seguridad siguen aplicándose a todo el sitio", async () => {
    // La regla de caché es una entrada aparte: si alguien la agregara
    // reemplazando la primera en vez de sumando, el sitio se quedaría sin
    // CSP y sin X-Frame-Options sin que nada más lo delate.
    const reglas = await reglasDeHeaders();
    const todas = reglas.find((r) => r.source === "/:path*");

    expect(todas, "falta la regla para todo el sitio").toBeDefined();
    const claves = todas!.headers.map((h) => h.key);
    expect(claves).toContain("Content-Security-Policy");
    expect(claves).toContain("X-Frame-Options");
    expect(claves).toContain("X-Content-Type-Options");
  });

  it("la regla de caché no pisa los encabezados de seguridad de /api", async () => {
    // Next.js acumula las reglas que coinciden, así que /api recibe las dos.
    // Se verifica que la de caché no declare su propio CSP ni nada que
    // pudiera entrar en conflicto con la global.
    const reglas = await reglasDeHeaders();
    const api = reglas.find((r) => r.source === "/api/:path*")!;

    expect(api.headers.map((h) => h.key)).toEqual(["Cache-Control"]);
  });
});
