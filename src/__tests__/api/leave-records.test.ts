import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24, Fase 52): pasó de
// calcular días laborables/feriados en Next.js/Prisma a ser un wrapper
// delgado sobre Django (`LeaveRecordListView`/`LeaveRecordDetailView`, Fase
// 29) — mockeado con `@/lib/djangoSession`. El cálculo real (exclusión de
// fines de semana/feriados, reglas de VACACIONES/duración) ya lo cubre la
// suite de Django (`backend/apps/configuration/tests/test_leave_records_view.py`).
// Acá solo se prueba ruteo/mapeo: sesión, forwarding de query params/body,
// traducción camelCase→snake_case, status codes, mapeo de ids a `string`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

const { GET: leaveRecordsGET, POST: leaveRecordsPOST } = await import("@/app/api/settings/leave-records/route");
const { DELETE: leaveRecordDELETE } = await import("@/app/api/settings/leave-records/[id]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
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

function getRequest(url: string) {
  return { nextUrl: new URL(url) } as never;
}

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const DJANGO_RECORD = {
  id: 7,
  userId: 3,
  user: { id: 3, name: "Ana" },
  type: "MEDICO",
  date: "2026-07-13",
  isFullDay: true,
  durationMinutes: null,
  observation: null,
};

describe("GET /api/settings/leave-records", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await leaveRecordsGET(getRequest("http://localhost/api/settings/leave-records"));
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await leaveRecordsGET(getRequest("http://localhost/api/settings/leave-records"));
    expect(res.status).toBe(403);
  });

  it("reenvía userId/month como user_id/month y mapea los ids a string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [DJANGO_RECORD]));
    const res = await leaveRecordsGET(
      getRequest("http://localhost/api/settings/leave-records?userId=3&month=2026-07")
    );
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/leave-records/?user_id=3&month=2026-07");
    const body = await res.json();
    expect(body).toEqual([{ ...DJANGO_RECORD, id: "7", userId: "3", user: { id: "3", name: "Ana" } }]);
  });
});

describe("POST /api/settings/leave-records", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión, sin llamar a Django", async () => {
    mockSession(null);
    const res = await leaveRecordsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "3", type: "MEDICO", startDate: "2026-07-13", endDate: "2026-07-13", isFullDay: true })
    );
    expect(res.status).toBe(403);
  });

  it("responde 400 si faltan campos requeridos, sin llamar a Django", async () => {
    mockSession({});
    const res = await leaveRecordsPOST(jsonRequest({ userId: "3" }));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 404 si el usuario no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Usuario no encontrado" }, 404));
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "999", type: "MEDICO", startDate: "2026-07-13", endDate: "2026-07-13", isFullDay: true })
    );
    expect(res.status).toBe(404);
  });

  it("propaga un mensaje de validación de Django (ej. rango sin días laborables)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: "El rango seleccionado no incluye días laborables" }, 400)
    );
    const res = await leaveRecordsPOST(
      jsonRequest({ userId: "3", type: "PERSONAL", startDate: "2026-07-18", endDate: "2026-07-19", isFullDay: true })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("El rango seleccionado no incluye días laborables");
  });

  it("traduce el body a snake_case y mapea la respuesta (records + businessDaysCount)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { records: [DJANGO_RECORD], businessDaysCount: 1 }, 201));
    const res = await leaveRecordsPOST(
      jsonRequest({
        userId: "3",
        type: "MEDICO",
        startDate: "2026-07-13",
        endDate: "2026-07-13",
        isFullDay: true,
        durationMinutes: undefined,
        observation: "  notas  ",
      })
    );
    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/leave-records/", {
      method: "POST",
      body: JSON.stringify({
        user_id: "3",
        type: "MEDICO",
        start_date: "2026-07-13",
        end_date: "2026-07-13",
        is_full_day: true,
        duration_minutes: undefined,
        observation: "  notas  ",
      }),
    });
    const body = await res.json();
    expect(body).toEqual({ records: [{ ...DJANGO_RECORD, id: "7", userId: "3", user: { id: "3", name: "Ana" } }], businessDaysCount: 1 });
  });
});

describe("DELETE /api/settings/leave-records/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await leaveRecordDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza por permisos", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await leaveRecordDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si el permiso no existe", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 404));
    const res = await leaveRecordDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("elimina el permiso existente", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await leaveRecordDELETE(jsonRequest(undefined), ctx("7"));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/leave-records/7/", { method: "DELETE" });
  });
});
