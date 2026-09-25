import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Dos peticiones simultáneas no pueden consumir dos rotaciones.
 *
 * Los dos sondeos del frontend usan el MISMO intervalo de 30s y arrancan
 * juntos, así que cuando vence el access disparan el refresco a la vez.
 * Medido en producción: el 89% de los refrescos ocurrían en ráfaga (985
 * segundos con 2 o más simultáneos contra 121 con uno solo). Django solo
 * tolera una generación hacia atrás, de modo que la segunda rotación convertía
 * el token de la primera en "reutilización" y revocaba la sesión entera — 1092
 * rechazos en un día, todos por sesión revocada.
 */

const almacen = new Map<string, string>();
let cookiesEscritas: { nombre: string; valor: string }[] = [];

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

const { DJANGO_REFRESH_COOKIE } = await import("@/lib/djangoTokenCookies");
const { djangoApiFetch } = await import("@/lib/djangoSession");

describe("Refresco de sesión — dos peticiones a la vez", () => {
  beforeEach(() => {
    almacen.clear();
    cookiesEscritas = [];
    almacen.set(DJANGO_REFRESH_COOKIE, "R1");
  });

  it("una sola rotación aunque dos peticiones la pidan juntas", async () => {
    let refrescos = 0;
    global.fetch = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/auth/token/refresh/")) {
        refrescos += 1;
        // Respuesta lenta a propósito: deja a las dos peticiones solapadas.
        return new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: true, json: () => Promise.resolve({ access: "A2", refresh: "R2" }) } as Response),
            30
          )
        );
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;

    await Promise.all([djangoApiFetch("/notifications/"), djangoApiFetch("/desk-notes/unread-count/")]);

    // Con una rotación por petición, la segunda dejaba a la primera con un
    // token "reutilizado" y Django revocaba la sesión.
    expect(refrescos).toBe(1);
  });

  it("las dos peticiones terminan con el MISMO token nuevo", async () => {
    global.fetch = vi.fn((url: string) =>
      typeof url === "string" && url.includes("/auth/token/refresh/")
        ? new Promise((resolve) =>
            setTimeout(
              () => resolve({ ok: true, json: () => Promise.resolve({ access: "A2", refresh: "R2" }) } as Response),
              20
            )
          )
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response)
    ) as unknown as typeof fetch;

    await Promise.all([djangoApiFetch("/notifications/"), djangoApiFetch("/desk-notes/unread-count/")]);

    const refrescos = cookiesEscritas.filter((c) => c.nombre === DJANGO_REFRESH_COOKIE);
    expect(refrescos.length).toBeGreaterThan(0);
    // Ninguna respuesta puede dejar el token viejo: eso es lo que revocaba.
    expect(refrescos.every((c) => c.valor === "R2")).toBe(true);
  });

  it("un refresco rechazado no deja la puerta trabada para el siguiente", async () => {
    let intentos = 0;
    global.fetch = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/auth/token/refresh/")) {
        intentos += 1;
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;

    await djangoApiFetch("/notifications/");
    await djangoApiFetch("/notifications/");

    // Si la entrada quedara cacheada, el segundo intento reusaría el fallo.
    expect(intentos).toBe(2);
  });
});
