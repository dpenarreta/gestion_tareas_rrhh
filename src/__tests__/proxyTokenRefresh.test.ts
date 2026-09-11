// @vitest-environment node
//
// El middleware corre en el servidor, no en el navegador. Con el entorno
// jsdom por defecto, `jose` falla al firmar ("payload must be an instance
// of Uint8Array") porque los Uint8Array de jsdom son de otro realm.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

// `session-secret.ts` valida el secreto AL IMPORTARSE (fail-closed), y el
// middleware lo importa: hay que definirlo antes de cargar nada, de ahí el
// `vi.hoisted` + import dinámico.
const SECRETO_DE_PRUEBA = vi.hoisted(() => {
  const valor = "secreto-de-prueba-para-el-middleware-0123456789";
  process.env.SESSION_SECRET = valor;
  return valor;
});

const { proxy } = await import("@/proxy");

/**
 * El middleware es el único punto del camino de una página que puede
 * escribir cookies: durante el render de un Server Component, Next.js no lo
 * permite. Y guardar el resultado del refresco no es opcional, porque
 * Django ROTA el refresh token e invalida el anterior — refrescar sin poder
 * persistirlo revoca la sesión en la petición siguiente.
 *
 * Sin esto, cada carga de página con el access vencido dejaba al layout sin
 * sesión Django y el aviso de tratamiento de datos reaparecía aunque ya
 * estuviera aceptado (ver docs/AUDIT_LOG.md § 2026-09-11).
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const secret = new TextEncoder().encode(SECRETO_DE_PRUEBA);

async function sesionValida() {
  return new SignJWT({ djangoUserId: 1, role: "ADMINISTRADOR", name: "Test", email: "t@n.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(secret);
}

async function pedir(path: string, cookies: Record<string, string>) {
  const request = new NextRequest(`http://localhost:3000${path}`);
  for (const [nombre, valor] of Object.entries(cookies)) {
    request.cookies.set(nombre, valor);
  }
  return proxy(request);
}

function respuestaDeRefresh(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 401, json: async () => body } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("middleware — refresco de los tokens de Django", () => {
  it("refresca cuando el access expiró y guarda AMBOS tokens", async () => {
    fetchMock.mockResolvedValue(
      respuestaDeRefresh({ access: "access-nuevo", refresh: "refresh-nuevo" })
    );

    const res = await pedir("/dashboard", {
      "nexo-session": await sesionValida(),
      "nexo-django-refresh": "refresh-viejo",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.cookies.get("nexo-django-access")?.value).toBe("access-nuevo");
    // Guardar el refresh nuevo es lo que evita que Django revoque la sesión
    // por reutilización en el siguiente refresco.
    expect(res.cookies.get("nexo-django-refresh")?.value).toBe("refresh-nuevo");
  });

  it("no llama a Django si el access todavía está vigente", async () => {
    const res = await pedir("/dashboard", {
      "nexo-session": await sesionValida(),
      "nexo-django-access": "access-vigente",
      "nexo-django-refresh": "refresh-viejo",
    });

    // Esto corre en CADA navegación: sin esta guarda, sería una llamada
    // extra a Django por página.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.cookies.get("nexo-django-access")).toBeUndefined();
  });

  it("no hace nada si no hay refresh token con el que renovar", async () => {
    const res = await pedir("/dashboard", { "nexo-session": await sesionValida() });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("no refresca en rutas de API, que renuevan por su cuenta", async () => {
    // Hacerlo también acá consumiría la rotación dos veces para la misma
    // navegación, y una de las dos copias quedaría invalidada.
    await pedir("/api/users", {
      "nexo-session": await sesionValida(),
      "nexo-django-refresh": "refresh-viejo",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deja pasar la navegación si Django rechaza el refresco", async () => {
    fetchMock.mockResolvedValue(respuestaDeRefresh({ detail: "inválido" }, false));

    const res = await pedir("/dashboard", {
      "nexo-session": await sesionValida(),
      "nexo-django-refresh": "refresh-muerto",
    });

    expect(res.status).toBe(200);
    expect(res.cookies.get("nexo-django-access")).toBeUndefined();
  });

  it("deja pasar la navegación si Django no responde", async () => {
    // Bloquear la página entera porque el backend está lento sería peor que
    // renderizarla y dejar que cada consumidor degrade.
    fetchMock.mockRejectedValue(new Error("timeout"));

    const res = await pedir("/dashboard", {
      "nexo-session": await sesionValida(),
      "nexo-django-refresh": "refresh-viejo",
    });

    expect(res.status).toBe(200);
  });

  it("sin sesión de Next.js no intenta refrescar: redirige al login", async () => {
    const res = await pedir("/dashboard", { "nexo-django-refresh": "refresh-viejo" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
