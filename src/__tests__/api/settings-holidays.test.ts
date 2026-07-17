import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const holidayFindMany = vi.fn();
const holidayFindUnique = vi.fn();
const holidayCreate = vi.fn();
const holidayDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    holiday: {
      findMany: (...a: unknown[]) => holidayFindMany(...a),
      findUnique: (...a: unknown[]) => holidayFindUnique(...a),
      create: (...a: unknown[]) => holidayCreate(...a),
      delete: (...a: unknown[]) => holidayDelete(...a),
    },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: holidaysGET, POST: holidaysPOST } = await import("@/app/api/settings/holidays/route");
const { DELETE: holidayDELETE } = await import("@/app/api/settings/holidays/[id]/route");

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

function getRequest(url: string) {
  return { nextUrl: new URL(url) } as never;
}

function ctx(id = "holiday-1") {
  return { params: Promise.resolve({ id }) };
}

function resetAll() {
  holidayFindMany.mockReset().mockResolvedValue([]);
  holidayFindUnique.mockReset().mockResolvedValue(null);
  holidayCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "new-holiday", ...data })
  );
  holidayDelete.mockReset().mockResolvedValue({});
  vi.mocked(getSession).mockReset();
}

describe("GET /api/settings/holidays", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await holidaysGET(getRequest("http://localhost/api/settings/holidays"));
    expect(res.status).toBe(401);
  });

  it("no exige rol Administrador para leer (cualquier autenticado puede consultar el calendario)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await holidaysGET(getRequest("http://localhost/api/settings/holidays"));
    expect(res.status).toBe(200);
  });

  it("sin year devuelve todos los feriados, ordenados por fecha", async () => {
    mockSession({});
    await holidaysGET(getRequest("http://localhost/api/settings/holidays"));
    expect(holidayFindMany).toHaveBeenCalledWith({ where: undefined, orderBy: { date: "asc" } });
  });

  it("con year filtra por el año dado", async () => {
    mockSession({});
    await holidaysGET(getRequest("http://localhost/api/settings/holidays?year=2026"));
    expect(holidayFindMany).toHaveBeenCalledWith({ where: { year: 2026 }, orderBy: { date: "asc" } });
  });
});

describe("POST /api/settings/holidays", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await holidaysPOST(jsonRequest({}))).status).toBe(401);
    mockSession({ role: "COORDINADOR_NACIONAL" });
    expect((await holidaysPOST(jsonRequest({}))).status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await holidaysPOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 si falta la fecha o el nombre", async () => {
    mockSession({});
    expect((await holidaysPOST(jsonRequest({ name: "Feriado" }))).status).toBe(400);
    expect((await holidaysPOST(jsonRequest({ date: "2026-01-01", name: "  " }))).status).toBe(400);
  });

  it("responde 400 si la fecha tiene formato inválido", async () => {
    mockSession({});
    const res = await holidaysPOST(jsonRequest({ date: "01-01-2026", name: "Feriado" }));
    expect(res.status).toBe(400);
  });

  it("responde 409 si ya existe un feriado en esa fecha", async () => {
    mockSession({});
    holidayFindUnique.mockResolvedValue({ id: "existing" });
    const res = await holidaysPOST(jsonRequest({ date: "2026-01-01", name: "Año Nuevo" }));
    expect(res.status).toBe(409);
    expect(holidayCreate).not.toHaveBeenCalled();
  });

  it("crea el feriado con el año derivado de la fecha", async () => {
    mockSession({});
    const res = await holidaysPOST(jsonRequest({ date: "2026-08-10", name: "  Primer Grito de Independencia  " }));
    expect(res.status).toBe(201);
    expect(holidayCreate).toHaveBeenCalledWith({
      data: { date: new Date(Date.UTC(2026, 7, 10)), name: "Primer Grito de Independencia", year: 2026 },
    });
  });
});

describe("DELETE /api/settings/holidays/[id]", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await holidayDELETE(jsonRequest(undefined), ctx())).status).toBe(401);
    mockSession({ role: "JEFE_NACIONAL" });
    expect((await holidayDELETE(jsonRequest(undefined), ctx())).status).toBe(403);
  });

  it("responde 404 si el feriado no existe", async () => {
    mockSession({});
    holidayFindUnique.mockResolvedValue(null);
    const res = await holidayDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("elimina el feriado existente", async () => {
    mockSession({});
    holidayFindUnique.mockResolvedValue({ id: "holiday-1" });
    const res = await holidayDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(holidayDelete).toHaveBeenCalledWith({ where: { id: "holiday-1" } });
  });
});
