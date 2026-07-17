import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const userFindUnique = vi.fn();
const holidayFindMany = vi.fn();
const leaveRecordFindMany = vi.fn();
const leaveRecordCreate = vi.fn();
const leaveRecordFindUniqueForDelete = vi.fn();
const leaveRecordDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    holiday: { findMany: (...a: unknown[]) => holidayFindMany(...a) },
    leaveRecord: {
      findMany: (...a: unknown[]) => leaveRecordFindMany(...a),
      create: (...a: unknown[]) => leaveRecordCreate(...a),
      findUnique: (...a: unknown[]) => leaveRecordFindUniqueForDelete(...a),
      delete: (...a: unknown[]) => leaveRecordDelete(...a),
    },
    $transaction: (calls: Promise<unknown>[]) => Promise.all(calls),
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { POST: leaveRecordsPOST } = await import("@/app/api/settings/leave-records/route");
const { DELETE: leaveRecordDELETE } = await import("@/app/api/settings/leave-records/[id]/route");

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

function ctx(id = "leave-1") {
  return { params: Promise.resolve({ id }) };
}

function resetAll() {
  userFindUnique.mockReset().mockResolvedValue({ id: "user-1" });
  holidayFindMany.mockReset().mockResolvedValue([]);
  leaveRecordFindMany.mockReset().mockResolvedValue([]);
  leaveRecordCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: `rec-${(data.date as Date).getTime()}`, ...data, user: { id: "user-1", name: "Ana" } })
  );
  leaveRecordFindUniqueForDelete.mockReset();
  leaveRecordDelete.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("POST /api/settings/leave-records", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await leaveRecordsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no es Administrador", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await leaveRecordsPOST(jsonRequest({}));
    expect(res.status).toBe(403);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(jsonRequest({ userId: "user-1" }));
    expect(res.status).toBe(400);
  });

  it("responde 400 si la fecha fin es anterior a la fecha inicio", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-1", type: "MEDICO", startDate: "2026-07-10", endDate: "2026-07-05", isFullDay: true })
    );
    expect(res.status).toBe(400);
  });

  it("responde 400 si el tipo VACACIONES se envía con isFullDay=false", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-1", type: "VACACIONES", startDate: "2026-07-13", endDate: "2026-07-13", isFullDay: false, durationMinutes: 180 })
    );
    expect(res.status).toBe(400);
  });

  it("responde 400 si un permiso parcial no trae duración válida", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-1", type: "MEDICO", startDate: "2026-07-13", endDate: "2026-07-13", isFullDay: false })
    );
    expect(res.status).toBe(400);
  });

  it("responde 404 si el usuario no existe", async () => {
    mockSession({});
    userFindUnique.mockResolvedValue(null);
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-x", type: "MEDICO", startDate: "2026-07-13", endDate: "2026-07-13", isFullDay: true })
    );
    expect(res.status).toBe(404);
  });

  it("un solo día (lunes 2026-07-13) crea exactamente 1 registro", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-1", type: "MEDICO", startDate: "2026-07-13", endDate: "2026-07-13", isFullDay: true })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.businessDaysCount).toBe(1);
    expect(leaveRecordCreate).toHaveBeenCalledTimes(1);
  });

  it("un rango lunes-viernes (2026-07-13 a 2026-07-17) crea 5 registros, uno por día laborable", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-1", type: "VACACIONES", startDate: "2026-07-13", endDate: "2026-07-17", isFullDay: true })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.businessDaysCount).toBe(5);
    expect(leaveRecordCreate).toHaveBeenCalledTimes(5);
  });

  it("un rango que incluye fin de semana (2026-07-13 a 2026-07-20, lun-lun) excluye sábado y domingo", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-1", type: "PERSONAL", startDate: "2026-07-13", endDate: "2026-07-20", isFullDay: true })
    );
    const body = await res.json();
    // lun 13 a lun 20 = 8 días calendario, 6 laborables (excluye sáb 18 y dom 19)
    expect(body.businessDaysCount).toBe(6);
  });

  it("excluye feriados configurados del rango, además de fines de semana", async () => {
    mockSession({});
    holidayFindMany.mockResolvedValue([{ date: new Date(Date.UTC(2026, 6, 14)) }]); // martes 14 jul feriado
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-1", type: "MEDICO", startDate: "2026-07-13", endDate: "2026-07-17", isFullDay: true })
    );
    const body = await res.json();
    // lun-vie (5 laborables) menos el feriado del martes = 4
    expect(body.businessDaysCount).toBe(4);
  });

  it("responde 400 si el rango no incluye ningún día laborable (solo fin de semana)", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "user-1", type: "PERSONAL", startDate: "2026-07-18", endDate: "2026-07-19", isFullDay: true })
    );
    expect(res.status).toBe(400);
  });

  it("un permiso parcial aplica la misma duración a cada día laborable creado", async () => {
    mockSession({});
    await leaveRecordsPOST(
      jsonRequest({
        userId: "user-1",
        type: "PERSONAL",
        startDate: "2026-07-13",
        endDate: "2026-07-14",
        isFullDay: false,
        durationMinutes: 90,
      })
    );
    expect(leaveRecordCreate).toHaveBeenCalledTimes(2);
    for (const call of leaveRecordCreate.mock.calls) {
      expect(call[0].data.durationMinutes).toBe(90);
      expect(call[0].data.isFullDay).toBe(false);
    }
  });
});

describe("DELETE /api/settings/leave-records/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await leaveRecordDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no es Administrador", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await leaveRecordDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si el permiso no existe", async () => {
    mockSession({});
    leaveRecordFindUniqueForDelete.mockResolvedValue(null);
    const res = await leaveRecordDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("elimina el permiso existente", async () => {
    mockSession({});
    leaveRecordFindUniqueForDelete.mockResolvedValue({ id: "leave-1" });
    const res = await leaveRecordDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(leaveRecordDelete).toHaveBeenCalledWith({ where: { id: "leave-1" } });
  });
});
