import { describe, expect, it, vi, beforeEach } from "vitest";

// Cobertura directa del refresco de tokens de `djangoApiFetch` — hallazgo de
// bug real (ver docs/AUDIT_LOG.md § 2026-09-02, "djangoApiFetch no
// refrescaba el access token de Django cuando la cookie ya había expirado
// del todo"): antes de este archivo, `djangoApiFetch` solo se probaba
// mockeado como caja negra en los tests de cada route.ts — su lógica
// interna de refresh nunca tuvo cobertura propia.

type CookieRecord = { name: string; value: string };

const store = new Map<string, string>();
const cookiesApi = {
  get: (name: string): CookieRecord | undefined => (store.has(name) ? { name, value: store.get(name)! } : undefined),
  set: (name: string, value: string) => {
    store.set(name, value);
  },
  delete: (name: string) => {
    store.delete(name);
  },
};

vi.mock("next/headers", () => ({ cookies: async () => cookiesApi }));
vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { djangoApiFetch, setDjangoTokenCookies } = await import("@/lib/djangoSession");

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  store.clear();
  fetchMock.mockReset();
});

describe("djangoApiFetch — refresh del access token", () => {
  it("null si no hay ni access ni refresh token", async () => {
    const result = await djangoApiFetch("/tasks/");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refresca automáticamente cuando la cookie de access ya expiró del todo (no está presente), reusando el refresh token", async () => {
    // Solo hay refresh token en la cookie — simula el escenario real: el
    // access token (15 min) ya venció y el navegador dejó de enviarlo.
    store.set("nexo-django-refresh", "refresh-valido");

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/auth/token/refresh/")) {
        return jsonResponse(200, { access: "access-nuevo" });
      }
      if (url.includes("/tasks/")) {
        return jsonResponse(200, { ok: true });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const result = await djangoApiFetch("/tasks/");

    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
    // Se llamó primero al refresh, y la request real usó el token nuevo.
    const tasksCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/tasks/"));
    expect(tasksCall?.[1]?.headers?.Authorization).toBe("Bearer access-nuevo");
  });

  it("null si no hay access token y el refresh también falla", async () => {
    store.set("nexo-django-refresh", "refresh-invalido");
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid" }));

    const result = await djangoApiFetch("/tasks/");

    expect(result).toBeNull();
    // Nunca debió intentar la request real sin un token válido.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/tasks/"))).toBe(false);
  });

  it("con access token presente pero vencido (401 de Django), sigue refrescando como antes", async () => {
    store.set("nexo-django-access", "access-vencido");
    store.set("nexo-django-refresh", "refresh-valido");

    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/auth/token/refresh/")) return jsonResponse(200, { access: "access-nuevo" });
      if (url.includes("/tasks/")) {
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === "Bearer access-vencido" ? jsonResponse(401, { error: "expired" }) : jsonResponse(200, { ok: true });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const result = await djangoApiFetch("/tasks/");
    expect(result!.status).toBe(200);
  });

  it("con access token válido, no llama al endpoint de refresh", async () => {
    store.set("nexo-django-access", "access-valido");
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await djangoApiFetch("/tasks/");

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/auth/token/refresh/"))).toBe(false);
  });
});

describe("setDjangoTokenCookies", () => {
  it("guarda access y refresh en las cookies", async () => {
    await setDjangoTokenCookies({ access: "a1", refresh: "r1" });
    expect(store.get("nexo-django-access")).toBe("a1");
    expect(store.get("nexo-django-refresh")).toBe("r1");
  });
});
