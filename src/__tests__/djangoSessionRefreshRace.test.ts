import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * La prueba de escritura previa al refresco no debe tocar la cookie del
 * refresh.
 *
 * Con el sondeo del frontend (campana y Escritorio Digital, cada 30s) dos
 * peticiones salen casi juntas cuando vence el access. Una rota y devuelve el
 * token nuevo; la otra cae en la ventana de gracia de Django y recibe SOLO un
 * access. Si esa segunda dejó escrito el refresh viejo como "prueba", su
 * respuesta pisa el token recién rotado cuando llega después — y pasada la
 * ventana, ese token viejo se presenta como reutilización y Django revoca la
 * sesión entera.
 */

const cookiesEscritas: { nombre: string; valor: string }[] = [];
const almacen = new Map<string, string>();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (almacen.has(n) ? { value: almacen.get(n) } : undefined),
    set: (nombre: string, valor: string) => {
      cookiesEscritas.push({ nombre, valor });
      almacen.set(nombre, valor);
    },
  }),
  headers: async () => new Map(),
}));
vi.mock("@/lib/logger", () => ({ safeLog: vi.fn() }));

const { DJANGO_REFRESH_COOKIE, DJANGO_ACCESS_COOKIE } = await import("@/lib/djangoTokenCookies");
const { djangoApiFetch } = await import("@/lib/djangoSession");

describe("Refresco de sesión — carrera de cookies con el sondeo", () => {
  beforeEach(() => {
    cookiesEscritas.length = 0;
    almacen.clear();
    almacen.set(DJANGO_REFRESH_COOKIE, "R1");
    // Sin access: es justo el momento en que el frontend dispara el refresco.
  });

  function respuestaDjango(cuerpo: unknown, status = 200) {
    return Promise.resolve({
      ok: status === 200,
      status,
      json: () => Promise.resolve(cuerpo),
    } as Response);
  }

  it("la petición que cae en la ventana de gracia no reescribe el refresh viejo", async () => {
    // Django devuelve SOLO access: es el reintento concurrente.
    global.fetch = vi.fn((url: string) =>
      typeof url === "string" && url.includes("/auth/token/refresh/")
        ? respuestaDjango({ access: "A2" })
        : respuestaDjango({ ok: true })
    ) as unknown as typeof fetch;

    await djangoApiFetch("/team/");

    const escrituras = cookiesEscritas.filter((c) => c.nombre === DJANGO_REFRESH_COOKIE);
    expect(escrituras).toEqual([]);
    // El access nuevo sí debe guardarse.
    expect(cookiesEscritas.some((c) => c.nombre === DJANGO_ACCESS_COOKIE && c.valor === "A2")).toBe(true);
  });

  it("cuando Django sí rota, el refresh nuevo se guarda una sola vez", async () => {
    global.fetch = vi.fn((url: string) =>
      typeof url === "string" && url.includes("/auth/token/refresh/")
        ? respuestaDjango({ access: "A2", refresh: "R2" })
        : respuestaDjango({ ok: true })
    ) as unknown as typeof fetch;

    await djangoApiFetch("/team/");

    const escrituras = cookiesEscritas.filter((c) => c.nombre === DJANGO_REFRESH_COOKIE);
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].valor).toBe("R2");
  });
});
