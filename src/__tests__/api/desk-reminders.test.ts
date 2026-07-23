import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const personalReminderFindMany = vi.fn();
const personalReminderFindUnique = vi.fn();
const personalReminderCreate = vi.fn();
const personalReminderUpdate = vi.fn();
const personalReminderDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personalReminder: {
      findMany: personalReminderFindMany,
      findUnique: personalReminderFindUnique,
      create: personalReminderCreate,
      update: personalReminderUpdate,
      delete: personalReminderDelete,
    },
  },
}));

const logDeskAudit = vi.fn();
vi.mock("@/lib/deskAudit", () => ({ logDeskAudit: (...args: unknown[]) => logDeskAudit(...args) }));

// notifyDueReminders toca prisma directamente (no expuesto en el mock de arriba) — se
// stubea para aislar la lógica de las rutas; advanceRepeat/todayRange quedan reales.
vi.mock("@/lib/deskReminders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deskReminders")>();
  return { ...actual, notifyDueReminders: vi.fn() };
});

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/desk-reminders/route");
const { PATCH, DELETE } = await import("@/app/api/desk-reminders/[id]/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
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

function ctx(id = "r1") {
  return { params: Promise.resolve({ id }) };
}

function getRequest(url: string): NextRequest {
  return { nextUrl: new URL(url), url } as unknown as NextRequest;
}

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const REMINDER_SELECT_ROW = {
  id: "r1",
  title: "Llamar a Finanzas",
  description: null,
  dueAt: new Date("2026-08-01T10:00:00Z"),
  priority: "MEDIA",
  status: "PENDIENTE",
  repeat: "UNA_VEZ",
  completedAt: null,
  createdAt: new Date("2026-07-20T10:00:00Z"),
};

function resetAll() {
  personalReminderFindMany.mockReset();
  personalReminderFindUnique.mockReset();
  personalReminderCreate.mockReset();
  personalReminderUpdate.mockReset();
  personalReminderDelete.mockReset();
  logDeskAudit.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/desk-reminders", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET(getRequest("http://localhost/api/desk-reminders"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para Administrador (canUseDeskNotes)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    const res = await GET(getRequest("http://localhost/api/desk-reminders"));
    expect(res.status).toBe(403);
  });

  it("filtra por status y escopa siempre al usuario de la sesión", async () => {
    mockSession({});
    personalReminderFindMany.mockResolvedValue([REMINDER_SELECT_ROW]);
    const res = await GET(getRequest("http://localhost/api/desk-reminders?status=PENDIENTE&limit=5"));
    expect(personalReminderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u1", status: "PENDIENTE" }),
        take: 5,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].dueAt).toBe("2026-08-01T10:00:00.000Z");
  });
});

describe("POST /api/desk-reminders", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await POST(jsonRequest({ title: "Solo título" }));
    expect(res.status).toBe(400);
  });

  it("responde 400 si dueAt es inválido", async () => {
    mockSession({});
    const res = await POST(jsonRequest({ title: "x", dueAt: "no-es-fecha" }));
    expect(res.status).toBe(400);
  });

  it("crea el recordatorio, registra auditoría CREATED y responde 201", async () => {
    mockSession({ userId: "u1" });
    personalReminderCreate.mockResolvedValue(REMINDER_SELECT_ROW);
    const res = await POST(jsonRequest({ title: "Llamar a Finanzas", dueAt: "2026-08-01T10:00:00Z" }));
    expect(res.status).toBe(201);
    expect(personalReminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u1", title: "Llamar a Finanzas", priority: "MEDIA", repeat: "UNA_VEZ" }) })
    );
    expect(logDeskAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "REMINDER", entityId: "r1", action: "CREATED" })
    );
  });
});

describe("PATCH /api/desk-reminders/[id]", () => {
  beforeEach(resetAll);

  it("responde 404 si el recordatorio no existe o es de otro usuario", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ ...REMINDER_SELECT_ROW, userId: "otro" });
    const res = await PATCH(jsonRequest({ action: "complete" }), ctx());
    expect(res.status).toBe(404);
  });

  it("completar sin repetición: marca COMPLETADO y no genera una nueva ocurrencia", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ ...REMINDER_SELECT_ROW, userId: "u1", repeat: "UNA_VEZ" });
    personalReminderUpdate.mockResolvedValue({ ...REMINDER_SELECT_ROW, status: "COMPLETADO", completedAt: new Date() });
    const res = await PATCH(jsonRequest({ action: "complete" }), ctx());
    expect(res.status).toBe(200);
    expect(personalReminderCreate).not.toHaveBeenCalled();
    expect(logDeskAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "COMPLETED" }));
  });

  it("completar con repetición DIARIO: genera automáticamente la siguiente ocurrencia un día después", async () => {
    mockSession({ userId: "u1" });
    const original = { ...REMINDER_SELECT_ROW, userId: "u1", repeat: "DIARIO", dueAt: new Date("2026-08-01T10:00:00.000Z") };
    personalReminderFindUnique.mockResolvedValue(original);
    personalReminderUpdate.mockResolvedValue({ ...original, status: "COMPLETADO" });
    personalReminderCreate.mockResolvedValue({ ...original, id: "r2", status: "PENDIENTE" });

    const res = await PATCH(jsonRequest({ action: "complete" }), ctx());
    expect(res.status).toBe(200);
    expect(personalReminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          title: original.title,
          repeat: "DIARIO",
          dueAt: new Date("2026-08-02T10:00:00.000Z"),
        }),
      })
    );
    expect(logDeskAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "COMPLETED", entityId: "r1" }));
    expect(logDeskAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATED", entityId: "r2" }));
  });

  it("posponer actualiza dueAt, reabre notified y audita POSTPONED con from/to", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ ...REMINDER_SELECT_ROW, userId: "u1" });
    personalReminderUpdate.mockResolvedValue({ ...REMINDER_SELECT_ROW, dueAt: new Date("2026-08-05T10:00:00Z") });
    const res = await PATCH(jsonRequest({ action: "postpone", dueAt: "2026-08-05T10:00:00Z" }), ctx());
    expect(res.status).toBe(200);
    expect(personalReminderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDIENTE", completedAt: null, notified: false }) })
    );
    expect(logDeskAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "POSTPONED", metadata: expect.objectContaining({ to: "2026-08-05T10:00:00.000Z" }) })
    );
  });

  it("cambiar prioridad audita PRIORITY_CHANGED con el valor anterior y el nuevo", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ ...REMINDER_SELECT_ROW, userId: "u1", priority: "MEDIA" });
    personalReminderUpdate.mockResolvedValue({ ...REMINDER_SELECT_ROW, priority: "URGENTE" });
    const res = await PATCH(jsonRequest({ priority: "URGENTE" }), ctx());
    expect(res.status).toBe(200);
    expect(logDeskAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PRIORITY_CHANGED", metadata: { from: "MEDIA", to: "URGENTE" } })
    );
  });

  it("editar solo el título audita EDITED (no PRIORITY_CHANGED)", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ ...REMINDER_SELECT_ROW, userId: "u1" });
    personalReminderUpdate.mockResolvedValue({ ...REMINDER_SELECT_ROW, title: "Nuevo título" });
    const res = await PATCH(jsonRequest({ title: "Nuevo título" }), ctx());
    expect(res.status).toBe(200);
    expect(logDeskAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "EDITED" }));
  });
});

describe("DELETE /api/desk-reminders/[id]", () => {
  beforeEach(resetAll);

  it("responde 404 si pertenece a otro usuario", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ userId: "otro" });
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
    expect(personalReminderDelete).not.toHaveBeenCalled();
  });

  it("elimina el recordatorio propio y audita DELETED", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ userId: "u1" });
    personalReminderDelete.mockResolvedValue({});
    const res = await DELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(logDeskAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETED" }));
  });
});
