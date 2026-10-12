// @vitest-environment node
//
// Mismo montaje que proxyTokenRefresh.test.ts: `jose` necesita el entorno
// node y el secreto debe existir antes de importar el middleware.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

const SECRETO_DE_PRUEBA = vi.hoisted(() => {
  const valor = "secreto-de-prueba-para-el-middleware-0123456789";
  process.env.SESSION_SECRET = valor;
  return valor;
});

const { proxy } = await import("@/proxy");
const secret = new TextEncoder().encode(SECRETO_DE_PRUEBA);

async function sesion(role: string) {
  return new SignJWT({ djangoUserId: 1, role, name: "Test", email: "t@n.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(secret);
}

async function pedir(path: string, role: string) {
  const request = new NextRequest(`http://localhost:3000${path}`);
  request.cookies.set("nexo-session", await sesion(role));
  // Access vigente: el middleware no intenta refrescar tokens de Django.
  request.cookies.set("nexo-django-access", "access-vigente");
  return proxy(request);
}

// Supervisores y Asistentes de Operaciones trabajan solo en Control
// Operativo: ocultar el menú no alcanza, el middleware corta también las URL
// escritas a mano y las APIs de otros módulos.
describe("middleware — roles operativos", () => {
  it.each(["SUPERVISOR_OPERACIONES", "ASISTENTE_OPERACIONES"])("%s: otras pantallas redirigen al módulo", async (role) => {
    for (const path of ["/dashboard", "/tasks", "/settings", "/admin/users"]) {
      const res = await pedir(path, role);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/control-operativo");
    }
    expect((await pedir("/control-operativo", role)).headers.get("location")).toBeNull();
  });

  it("bloquea APIs de otros módulos y deja pasar las del módulo y del shell", async () => {
    const role = "SUPERVISOR_OPERACIONES";
    expect((await pedir("/api/tasks", role)).status).toBe(403);
    expect((await pedir("/api/admin/roles", role)).status).toBe(403);
    for (const path of ["/api/novedades/me", "/api/notifications", "/api/auth/me", "/api/users/5/theme"]) {
      const res = await pedir(path, role);
      expect(res.status).toBe(200);
    }
  });

  it("no afecta a los demás roles", async () => {
    const res = await pedir("/dashboard", "ADMINISTRADOR");
    expect(res.headers.get("location")).toBeNull();
    expect((await pedir("/api/tasks", "ASISTENTE_GH")).status).toBe(200);
  });
});
