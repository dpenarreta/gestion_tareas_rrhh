import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const activityReasonFindUnique = vi.fn();
const activityReasonCreate = vi.fn();
const activityReasonUpdate = vi.fn();
const activityReasonFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityReason: {
      findUnique: (...a: unknown[]) => activityReasonFindUnique(...a),
      create: (...a: unknown[]) => activityReasonCreate(...a),
      update: (...a: unknown[]) => activityReasonUpdate(...a),
      findMany: (...a: unknown[]) => activityReasonFindMany(...a),
    },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { POST: reasonsPOST } = await import("@/app/api/settings/activity-reasons/route");
const { PATCH: reasonPATCH } = await import("@/app/api/settings/activity-reasons/[id]/route");
const { GET: publicReasonsGET } = await import("@/app/api/activity-reasons/route");

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

function ctx(id = "reason-1") {
  return { params: Promise.resolve({ id }) };
}

function resetAll() {
  activityReasonFindUnique.mockReset().mockResolvedValue(null);
  activityReasonCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "new-reason", isActive: true, isArchived: false, archivedAt: null, ...data })
  );
  activityReasonUpdate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "reason-1", key: "EXISTENTE", label: "Existente", isActive: true, isArchived: false, archivedAt: null, assignedRoles: [], ...data })
  );
  activityReasonFindMany.mockReset().mockResolvedValue([]);
  vi.mocked(getSession).mockReset();
}

describe("POST /api/settings/activity-reasons", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await reasonsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no es Administrador", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await reasonsPOST(jsonRequest({ label: "Motivo", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await reasonsPOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 si falta el nombre", async () => {
    mockSession({});
    const res = await reasonsPOST(jsonRequest({ label: "   ", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(400);
  });

  it("responde 400 si no hay roles válidos seleccionados", async () => {
    mockSession({});
    expect((await reasonsPOST(jsonRequest({ label: "Motivo", assignedRoles: [] }))).status).toBe(400);
    expect((await reasonsPOST(jsonRequest({ label: "Motivo", assignedRoles: ["NO_EXISTE"] }))).status).toBe(400);
  });

  it("genera la key en mayúsculas sin tildes a partir del nombre", async () => {
    mockSession({});
    const res = await reasonsPOST(jsonRequest({ label: "Café con el equipo", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(201);
    expect(activityReasonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: "CAFE_CON_EL_EQUIPO", label: "Café con el equipo" }) })
    );
  });

  it("agrega un sufijo numérico si la key ya existe", async () => {
    mockSession({});
    activityReasonFindUnique
      .mockResolvedValueOnce({ id: "existing", key: "REUNION" }) // primer intento ocupado
      .mockResolvedValueOnce(null); // REUNION_2 libre
    const res = await reasonsPOST(jsonRequest({ label: "Reunión", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(201);
    expect(activityReasonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: "REUNION_2" }) })
    );
  });

  it("guarda la descripción recortada o null si no se envía", async () => {
    mockSession({});
    const res = await reasonsPOST(jsonRequest({ label: "Motivo", description: "  detalle  ", assignedRoles: ["ADMINISTRADOR"] }));
    expect(res.status).toBe(201);
    expect(activityReasonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: "detalle" }) })
    );
  });
});

describe("PATCH /api/settings/activity-reasons/[id]", () => {
  beforeEach(resetAll);

  it("responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await reasonPATCH(jsonRequest({}), ctx())).status).toBe(401);
    mockSession({ role: "COORDINADOR_NACIONAL" });
    expect((await reasonPATCH(jsonRequest({}), ctx())).status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await reasonPATCH(badJsonRequest(), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si se envía un label vacío", async () => {
    mockSession({});
    activityReasonFindUnique.mockResolvedValue({ id: "reason-1" });
    const res = await reasonPATCH(jsonRequest({ label: "   " }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si assignedRoles queda vacío o con un rol inválido", async () => {
    mockSession({});
    activityReasonFindUnique.mockResolvedValue({ id: "reason-1" });
    expect((await reasonPATCH(jsonRequest({ assignedRoles: [] }), ctx())).status).toBe(400);
    expect((await reasonPATCH(jsonRequest({ assignedRoles: ["NO_EXISTE"] }), ctx())).status).toBe(400);
  });

  it("responde 404 si el motivo no existe", async () => {
    mockSession({});
    activityReasonFindUnique.mockResolvedValue(null);
    const res = await reasonPATCH(jsonRequest({ label: "Nuevo nombre" }), ctx());
    expect(res.status).toBe(404);
  });

  it("desactivar (isActive=false) no toca isArchived", async () => {
    mockSession({});
    activityReasonFindUnique.mockResolvedValue({ id: "reason-1" });
    const res = await reasonPATCH(jsonRequest({ isActive: false }), ctx());
    expect(res.status).toBe(200);
    expect(activityReasonUpdate).toHaveBeenCalledWith({ where: { id: "reason-1" }, data: { isActive: false } });
  });

  it("archivar fuerza isActive=false y fija archivedAt", async () => {
    mockSession({});
    activityReasonFindUnique.mockResolvedValue({ id: "reason-1" });
    const res = await reasonPATCH(jsonRequest({ isArchived: true }), ctx());
    expect(res.status).toBe(200);
    expect(activityReasonUpdate).toHaveBeenCalledWith({
      where: { id: "reason-1" },
      data: { isArchived: true, archivedAt: expect.any(Date), isActive: false },
    });
  });

  it("restaurar limpia archivedAt sin reactivar automáticamente", async () => {
    mockSession({});
    activityReasonFindUnique.mockResolvedValue({ id: "reason-1" });
    const res = await reasonPATCH(jsonRequest({ isArchived: false }), ctx());
    expect(res.status).toBe(200);
    expect(activityReasonUpdate).toHaveBeenCalledWith({
      where: { id: "reason-1" },
      data: { isArchived: false, archivedAt: null },
    });
  });

  it("actualiza label, description y assignedRoles juntos", async () => {
    mockSession({});
    activityReasonFindUnique.mockResolvedValue({ id: "reason-1" });
    const res = await reasonPATCH(
      jsonRequest({ label: "  Nuevo  ", description: null, assignedRoles: ["JEFE_NACIONAL", "ADMINISTRADOR"] }),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(activityReasonUpdate).toHaveBeenCalledWith({
      where: { id: "reason-1" },
      data: { label: "Nuevo", description: null, assignedRoles: ["JEFE_NACIONAL", "ADMINISTRADOR"] },
    });
  });
});

describe("GET /api/activity-reasons (listado público)", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await publicReasonsGET();
    expect(res.status).toBe(401);
  });

  it("devuelve todos los motivos (activos, inactivos y archivados) para cualquier usuario autenticado", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    activityReasonFindMany.mockResolvedValue([
      { id: "1", key: "A", label: "A", description: null, isActive: true, isArchived: false, archivedAt: null, assignedRoles: ["ASISTENTE_GH"] },
      { id: "2", key: "B", label: "B", description: null, isActive: false, isArchived: true, archivedAt: "2026-01-01T00:00:00.000Z", assignedRoles: [] },
    ]);
    const res = await publicReasonsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[1].isArchived).toBe(true);
  });
});
