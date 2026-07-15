import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const taskFindMany = vi.fn();
const taskFindUnique = vi.fn();
const taskCreate = vi.fn();
const taskUpdate = vi.fn();
const taskDelete = vi.fn();
const notificationCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: taskFindMany, findUnique: taskFindUnique, create: taskCreate, update: taskUpdate, delete: taskDelete },
    notification: { create: notificationCreate },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const attachUnreadComments = vi.fn(async (tasks: unknown[]) => tasks.map((t) => ({ ...(t as object), hasUnreadComments: false })));
vi.mock("@/lib/commentViews", () => ({
  attachUnreadComments: (...args: [unknown[], string]) => attachUnreadComments(...args),
}));

const { getSession } = await import("@/lib/session");
const { GET: tasksGET, POST: tasksPOST } = await import("@/app/api/tasks/route");
const { PATCH: taskPATCH, DELETE: taskDELETE } = await import("@/app/api/tasks/[id]/route");

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

function ctx(id = "task-1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function resetAll() {
  taskFindMany.mockReset();
  taskFindUnique.mockReset();
  taskCreate.mockReset();
  taskUpdate.mockReset();
  taskDelete.mockReset();
  notificationCreate.mockReset().mockResolvedValue({});
  attachUnreadComments.mockClear();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/tasks", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await tasksGET();
    expect(res.status).toBe(401);
  });

  it("filtra por las tareas propias no archivadas", async () => {
    mockSession({});
    taskFindMany.mockResolvedValue([]);
    await tasksGET();
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assignedToId: "u1", archivedMonth: null } })
    );
  });
});

describe("POST /api/tasks", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await tasksPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({});
    const res = await tasksPOST(jsonRequest({ title: "Tarea" }));
    expect(res.status).toBe(400);
  });

  it("crea la tarea con status/progress por defecto y notifica al asignado si es otra persona", async () => {
    mockSession({ userId: "u1", name: "Ana" });
    taskCreate.mockResolvedValue({ id: "task-1", title: "Nueva tarea" });

    const res = await tasksPOST(
      jsonRequest({
        title: "Nueva tarea",
        priority: "ALTA",
        frequency: "PUNTUAL",
        startDate: "2026-01-01",
        endDate: "2026-01-05",
        estimatedHours: "4",
        assignedToId: "other-user",
      })
    );
    expect(res.status).toBe(201);
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDIENTE", progress: 0, assignedToId: "other-user", createdById: "u1" }),
      })
    );
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "other-user", taskId: "task-1" }) })
    );
  });

  it("no notifica si la tarea se autoasigna", async () => {
    mockSession({ userId: "u1" });
    taskCreate.mockResolvedValue({ id: "task-1", title: "Tarea propia" });
    await tasksPOST(
      jsonRequest({
        title: "Tarea propia",
        priority: "MEDIA",
        frequency: "PUNTUAL",
        startDate: "2026-01-01",
        endDate: "2026-01-05",
        estimatedHours: "2",
        assignedToId: "u1",
      })
    );
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("con status inicial COMPLETADA, el progreso se establece en 100", async () => {
    mockSession({ userId: "u1" });
    taskCreate.mockResolvedValue({ id: "task-1" });
    await tasksPOST(
      jsonRequest({
        title: "Tarea",
        status: "COMPLETADA",
        priority: "MEDIA",
        frequency: "PUNTUAL",
        startDate: "2026-01-01",
        endDate: "2026-01-05",
        estimatedHours: "2",
        assignedToId: "u1",
      })
    );
    expect(taskCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ progress: 100 }) }));
  });
});

describe("PATCH /api/tasks/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await taskPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    taskFindUnique.mockResolvedValue(null);
    const res = await taskPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si no es el responsable, el creador, ni está dentro de la jerarquía visible", async () => {
    mockSession({ role: "ASISTENTE_GH", userId: "u1" });
    taskFindUnique.mockResolvedValue({
      id: "task-1",
      assignedToId: "otro",
      createdById: "otro-creador",
      archivedMonth: null,
      assignedTo: { role: "COORDINADOR_ZS" },
    });
    const res = await taskPATCH(jsonRequest({ title: "x" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 403 si la tarea está archivada", async () => {
    mockSession({ userId: "u1" });
    taskFindUnique.mockResolvedValue({
      id: "task-1",
      assignedToId: "u1",
      createdById: "u1",
      archivedMonth: "2026-01",
      assignedTo: { role: "ASISTENTE_GH" },
    });
    const res = await taskPATCH(jsonRequest({ title: "x" }), ctx());
    expect(res.status).toBe(403);
  });

  it("un creador que no es el responsable puede editar campos generales pero no horas/color/estado", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: "creador-1" });
    taskFindUnique.mockResolvedValue({
      id: "task-1",
      assignedToId: "otro-usuario",
      createdById: "creador-1",
      archivedMonth: null,
      assignedTo: { role: "ASISTENTE_GH" },
    });

    const resStatus = await taskPATCH(jsonRequest({ status: "COMPLETADA" }), ctx());
    expect(resStatus.status).toBe(403);

    const resHours = await taskPATCH(jsonRequest({ realHours: 5 }), ctx());
    expect(resHours.status).toBe(403);

    const resColor = await taskPATCH(jsonRequest({ color: "#fff" }), ctx());
    expect(resColor.status).toBe(403);
  });

  it("el responsable puede actualizar horas reales, color y estado, con progreso/completedAt derivados", async () => {
    mockSession({ userId: "u1" });
    taskFindUnique.mockResolvedValue({
      id: "task-1",
      assignedToId: "u1",
      createdById: "otro",
      archivedMonth: null,
      assignedTo: { role: "ASISTENTE_GH" },
    });
    taskUpdate.mockResolvedValue({ id: "task-1", status: "COMPLETADA" });

    await taskPATCH(jsonRequest({ status: "COMPLETADA", realHours: 5.128 }), ctx());
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETADA", progress: 100, completedAt: expect.any(Date), realHours: 5.13 }),
      })
    );
  });

  it("volver a PENDIENTE reinicia el progreso a 0 y limpia completedAt", async () => {
    mockSession({ userId: "u1" });
    taskFindUnique.mockResolvedValue({
      id: "task-1",
      assignedToId: "u1",
      createdById: "u1",
      archivedMonth: null,
      assignedTo: { role: "ASISTENTE_GH" },
    });
    taskUpdate.mockResolvedValue({});

    await taskPATCH(jsonRequest({ status: "PENDIENTE" }), ctx());
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ progress: 0, completedAt: null }) })
    );
  });

  it("un rol dentro de la jerarquía visible (aunque no sea responsable ni creador) puede editar campos generales", async () => {
    mockSession({ role: "COORDINADOR_ZS", userId: "coordinador-1" });
    taskFindUnique.mockResolvedValue({
      id: "task-1",
      assignedToId: "subordinado-1",
      createdById: "subordinado-1",
      archivedMonth: null,
      assignedTo: { role: "ASISTENTE_GH_ZS" },
    });
    taskUpdate.mockResolvedValue({});
    const res = await taskPATCH(jsonRequest({ title: "Editado por coordinador" }), ctx());
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/tasks/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({});
    taskFindUnique.mockResolvedValue(null);
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si la tarea está archivada", async () => {
    mockSession({});
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01", createdById: "otro" });
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 403 si no es el creador ni un rol administrativo", async () => {
    mockSession({ role: "ASISTENTE_GH", userId: "u1" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: null, createdById: "otro" });
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
    expect(taskDelete).not.toHaveBeenCalled();
  });

  it("el creador puede eliminar su propia tarea", async () => {
    mockSession({ role: "ASISTENTE_GH", userId: "u1" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: null, createdById: "u1" });
    taskDelete.mockResolvedValue({});
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
  });

  it("un rol administrativo (JEFE_NACIONAL) puede eliminar tareas de otros", async () => {
    mockSession({ role: "JEFE_NACIONAL", userId: "jefe-1" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: null, createdById: "otro" });
    taskDelete.mockResolvedValue({});
    const res = await taskDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
  });
});
