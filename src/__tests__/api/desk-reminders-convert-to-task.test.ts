import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const personalReminderFindUnique = vi.fn();
const personalReminderUpdate = vi.fn();
const taskCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personalReminder: { findUnique: personalReminderFindUnique, update: personalReminderUpdate },
    task: { create: taskCreate },
  },
}));

vi.mock("@/lib/analytics", () => ({ invalidateAnalyticsCache: vi.fn() }));

const logDeskAudit = vi.fn();
vi.mock("@/lib/deskAudit", () => ({ logDeskAudit: (...args: unknown[]) => logDeskAudit(...args) }));

const { getSession } = await import("@/lib/session");
const { POST: convertToTask } = await import("@/app/api/desk-reminders/[id]/convert-to-task/route");

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

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const CONVERT_BODY = { startDate: "2026-08-01", endDate: "2026-08-08", estimatedHours: 1 };

const REMINDER_ROW = {
  userId: "u1",
  title: "Llamar a Finanzas",
  description: "No olvides revisar el contrato",
  priority: "URGENTE",
  attachmentName: "contrato.pdf",
  convertedToTaskId: null,
};

function resetAll() {
  personalReminderFindUnique.mockReset();
  personalReminderUpdate.mockReset();
  taskCreate.mockReset();
  logDeskAudit.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("POST /api/desk-reminders/[id]/convert-to-task", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si el recordatorio no existe", async () => {
    mockSession({});
    personalReminderFindUnique.mockResolvedValue(null);
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien convierte no es el dueño del recordatorio", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ ...REMINDER_ROW, userId: "otro" });
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 409 si ya fue convertido antes", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue({ ...REMINDER_ROW, convertedToTaskId: "task-old" });
    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx());
    expect(res.status).toBe(409);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue(REMINDER_ROW);
    const res = await convertToTask(jsonRequest({}), ctx());
    expect(res.status).toBe(400);
  });

  it("URGENTE se traduce a ALTA, referencia el adjunto en la descripción, y marca el recordatorio sin eliminarlo", async () => {
    mockSession({ userId: "u1" });
    personalReminderFindUnique.mockResolvedValue(REMINDER_ROW);
    taskCreate.mockResolvedValue({ id: "task-1", title: "Llamar a Finanzas" });
    personalReminderUpdate.mockResolvedValue({});

    const res = await convertToTask(jsonRequest(CONVERT_BODY), ctx("r1"));
    expect(res.status).toBe(201);

    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Llamar a Finanzas",
          priority: "ALTA",
          assignedToId: "u1",
          createdById: "u1",
          description: expect.stringContaining("contrato.pdf"),
        }),
      })
    );
    expect(personalReminderUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({ convertedToTaskId: "task-1" }),
    });
    expect(logDeskAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "REMINDER", action: "CONVERTED_TO_TASK", metadata: { taskId: "task-1" } })
    );
  });
});
