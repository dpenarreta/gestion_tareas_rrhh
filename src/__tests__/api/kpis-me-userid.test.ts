import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 4b de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-11):
// GET /api/kpis/me y GET /api/kpis/[userId] pasaron de calcular KPIs en
// Next.js/Prisma (`computeCargaTiempo`, jerarquía, redacción de datos
// sensibles) a ser un wrapper delgado sobre Django (`KpiMeView`/
// `KpiUserView`) — este archivo mockeaba `@/lib/prisma`/`@/lib/workload`
// hasta esta actualización, probando cálculos que ya NO viven acá (esa
// lógica está en `backend/apps/analytics/**`, con su propia cobertura).
// Acá solo se cubre lo que el wrapper de Next.js realmente hace: sesión,
// forwarding del parámetro `month`, status codes, mapeo snake_case→camelCase.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET: meGET } = await import("@/app/api/kpis/me/route");
const { GET: userIdGET } = await import("@/app/api/kpis/[userId]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Ana",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function getRequest(url = "http://localhost/api/kpis/me"): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function ctx(userId = "target-1") {
  return { params: Promise.resolve({ userId }) };
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/kpis/me", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meGET(getRequest());
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await meGET(getRequest());
    expect(res.status).toBe(401);
  });

  it("propaga el status de error de Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 500));
    const res = await meGET(getRequest());
    expect(res.status).toBe(500);
  });

  it("reenvía el parámetro month y mapea la respuesta a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { user: { id: 1, name: "Ana" }, carga_laboral: { real_hours: 5, estimated_hours: 8 } })
    );

    const res = await meGET(getRequest("http://localhost/api/kpis/me?month=2026-06"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/kpis/me/?month=2026-06");
    const body = await res.json();
    expect(body).toEqual({ user: { id: 1, name: "Ana" }, cargaLaboral: { realHours: 5, estimatedHours: 8 } });
  });

  it("sin month, no agrega query string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, {}));
    await meGET(getRequest());
    expect(djangoApiFetch).toHaveBeenCalledWith("/kpis/me/");
  });
});

describe("GET /api/kpis/[userId]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await userIdGET(getRequest(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await userIdGET(getRequest(), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el usuario objetivo no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await userIdGET(getRequest(), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el objetivo está fuera de la jerarquía visible del solicitante", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await userIdGET(getRequest(), ctx());
    expect(res.status).toBe(403);
  });

  it("reenvía userId/month a Django y mapea la respuesta a camelCase", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { user: { id: 5, name: "Ana" }, sensitive_detail_visible: false })
    );

    const res = await userIdGET(getRequest("http://localhost/api/kpis/target-1?month=2026-06"), ctx("target-1"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/kpis/target-1/?month=2026-06");
    const body = await res.json();
    expect(body).toEqual({ user: { id: 5, name: "Ana" }, sensitiveDetailVisible: false });
  });
});
