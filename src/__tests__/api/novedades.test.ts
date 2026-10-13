import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// El proxy del módulo Control Operativo de Novedades no decide permisos (lo
// hace Django en cada llamada): se prueba que reenvía la ruta correcta, que
// adapta snake_case↔camelCase en ambos sentidos, que propaga los códigos de
// error de Django y que no permite rutas arbitrarias.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const djangoApiFetch = vi.fn();
class DjangoUnavailableError extends Error {}
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  DjangoUnavailableError,
}));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/novedades/[...path]/route");

function mockSession(session: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    session === null
      ? null
      : {
          djangoUserId: 1,
          permissions: [],
          role: "SUPERVISOR_OPERACIONES",
          name: "Sup",
          email: "sup@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...session,
        },
  );
}

function request(url: string, body?: unknown) {
  return {
    nextUrl: new URL(url),
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as never;
}

function ctx(...path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function djangoResponse(status: number, data: unknown, contentType = "application/json") {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": contentType }),
    json: async () => data,
    arrayBuffer: async () => new ArrayBuffer(4),
  } as unknown as Response;
}

beforeEach(() => {
  djangoApiFetch.mockReset();
  vi.mocked(getSession).mockReset();
});

describe("/api/novedades/[...path]", () => {
  it("401 sin sesión, sin llamar a Django", async () => {
    mockSession(null);
    const res = await GET(request("http://localhost/api/novedades/me"), ctx("me"));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("503 claro si Django no responde (sin traza ni mensaje de timeout engañoso)", async () => {
    mockSession({});
    djangoApiFetch.mockRejectedValue(new DjangoUnavailableError("down"));
    const res = await GET(request("http://localhost/api/novedades/me"), ctx("me"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/no está disponible temporalmente/);
  });

  it("en un POST que excede el tiempo, avisa verificar antes de repetir", async () => {
    mockSession({});
    djangoApiFetch.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    const res = await POST(request("http://localhost/api/novedades/me", {}), ctx("me"));
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/Verifique si el cambio se guardó/);
  });

  it("rechaza segmentos de ruta no válidos", async () => {
    mockSession({});
    const res = await GET(request("http://localhost/api/novedades/x"), ctx("..", "admin"));
    expect(res.status).toBe(404);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("reenvía ruta y query, y adapta la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(200, { national_read: false, current_period: { code: "2026-10" }, rows: [{ cells: { "2026-10-12": { hours: "8" } } }] }),
    );
    const res = await GET(request("http://localhost/api/novedades/worked-days?period=2026-10"), ctx("worked-days"));
    expect(djangoApiFetch.mock.calls[0][0]).toBe("/novedades/worked-days/?period=2026-10");
    const body = await res.json();
    expect(body.nationalRead).toBe(false);
    expect(body.currentPeriod.code).toBe("2026-10");
    // Las claves de fecha no se alteran.
    expect(body.rows[0].cells["2026-10-12"].hours).toBe("8");
  });

  it("convierte el cuerpo a snake_case al enviarlo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(200, { saved: 1 }));
    await POST(
      request("http://localhost/api/novedades/worked-days/save", {
        period: "2026-10",
        supervisorId: 3,
        cells: [{ collaboratorId: 9, date: "2026-10-12", hours: "8" }],
      }),
      ctx("worked-days", "save"),
    );
    const [path, init] = djangoApiFetch.mock.calls[0];
    expect(path).toBe("/novedades/worked-days/save/");
    expect(JSON.parse(init.body)).toEqual({
      period: "2026-10",
      supervisor_id: 3,
      cells: [{ collaborator_id: 9, date: "2026-10-12", hours: "8" }],
    });
  });

  it("propaga 403/409 con el mensaje y los detalles de Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(409, {
        error: { code: "period_closed", message: "El período Octubre 2026 está cerrado.", details: { cells: [{ collaborator_id: 9 }] } },
      }),
    );
    const res = await POST(request("http://localhost/api/novedades/worked-days/save", {}), ctx("worked-days", "save"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "El período Octubre 2026 está cerrado.",
      code: "period_closed",
      details: { cells: [{ collaboratorId: 9 }] },
    });
  });

  it("reenvía el Excel exportado como archivo", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(200, null, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    );
    const res = await GET(request("http://localhost/api/novedades/overtime/export"), ctx("overtime", "export"));
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(djangoApiFetch.mock.calls[0][2]).toBeGreaterThan(3000);
  });

  it("devuelve 401 legible si no hay sesión de Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await GET(request("http://localhost/api/novedades/me"), ctx("me"));
    expect(res.status).toBe(401);
  });
});
