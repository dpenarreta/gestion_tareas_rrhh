import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...a: unknown[]) => userFindMany(...a),
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: kpiStartDateGET, PATCH: kpiStartDatePATCH } = await import("@/app/api/settings/kpi-start-date/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "admin-1",
          role: "ADMINISTRADOR",
          name: "Admin",
          email: "admin@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function badJsonRequest() {
  return { json: async () => { throw new Error("bad"); } } as never;
}

function resetAll() {
  userFindMany.mockReset().mockResolvedValue([]);
  userFindUnique.mockReset().mockResolvedValue(null);
  userUpdate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "user-1", name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH", ...data })
  );
  vi.mocked(getSession).mockReset();
}

describe("GET /api/settings/kpi-start-date", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await kpiStartDateGET()).status).toBe(401);
    mockSession({ role: "COORDINADOR_NACIONAL" });
    expect((await kpiStartDateGET()).status).toBe(403);
  });

  it("devuelve todos los usuarios ordenados por nombre con su kpiStartDate", async () => {
    mockSession({});
    userFindMany.mockResolvedValue([{ id: "u1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", kpiStartDate: null }]);
    const res = await kpiStartDateGET();
    expect(res.status).toBe(200);
    expect(userFindMany).toHaveBeenCalledWith({
      select: { id: true, name: true, email: true, role: true, kpiStartDate: true },
      orderBy: { name: "asc" },
    });
    const body = await res.json();
    expect(body).toEqual([{ id: "u1", name: "Ana", email: "a@nexo.com", role: "ASISTENTE_GH", kpiStartDate: null }]);
  });
});

describe("PATCH /api/settings/kpi-start-date", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await kpiStartDatePATCH(jsonRequest({}))).status).toBe(401);
    mockSession({ role: "JEFE_NACIONAL" });
    expect((await kpiStartDatePATCH(jsonRequest({}))).status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await kpiStartDatePATCH(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 si falta userId", async () => {
    mockSession({});
    const res = await kpiStartDatePATCH(jsonRequest({ kpiStartDate: "2026-07-13" }));
    expect(res.status).toBe(400);
  });

  it("responde 400 si kpiStartDate tiene formato inválido", async () => {
    mockSession({});
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "u1", kpiStartDate: "13-07-2026" }));
    expect(res.status).toBe(400);
  });

  it("responde 404 si el usuario no existe", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue(null);
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "u1", kpiStartDate: "2026-07-13" }));
    expect(res.status).toBe(404);
  });

  it("establece la fecha de inicio de cálculo para el usuario", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1" });
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "u1", kpiStartDate: "2026-07-13" }));
    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { kpiStartDate: new Date(Date.UTC(2026, 6, 13)) },
      select: { id: true, name: true, email: true, role: true, kpiStartDate: true },
    });
  });

  it("kpiStartDate null o vacío quita el ajuste (lo deja en null)", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue({ id: "u1" });
    const res = await kpiStartDatePATCH(jsonRequest({ userId: "u1", kpiStartDate: null }));
    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { kpiStartDate: null },
      select: { id: true, name: true, email: true, role: true, kpiStartDate: true },
    });
  });
});
