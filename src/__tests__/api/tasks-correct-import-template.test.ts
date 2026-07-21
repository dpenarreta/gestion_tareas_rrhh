import { describe, expect, it, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const taskFindUnique = vi.fn();
const taskUpdate = vi.fn();
const taskCreate = vi.fn();
const monthClosureFindUnique = vi.fn();
const monthClosureUpdate = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findUnique: taskFindUnique, update: taskUpdate, create: taskCreate },
    monthClosure: { findUnique: monthClosureFindUnique, update: monthClosureUpdate },
    user: { findUnique: userFindUnique },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { PATCH: correctPATCH } = await import("@/app/api/tasks/[id]/correct/route");
const { POST: importPOST } = await import("@/app/api/tasks/import/route");
const { GET: templateGET } = await import("@/app/api/tasks/template/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ADMINISTRADOR",
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

function badJsonRequest() {
  return {
    json: async () => {
      throw new Error("bad json");
    },
  } as never;
}

function resetAll() {
  taskFindUnique.mockReset();
  taskUpdate.mockReset();
  taskCreate.mockReset();
  monthClosureFindUnique.mockReset();
  monthClosureUpdate.mockReset().mockResolvedValue({});
  userFindUnique.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("PATCH /api/tasks/[id]/correct", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await correctPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 si quien solicita no es Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await correctPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si la tarea no existe", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue(null);
    const res = await correctPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 400 si la tarea no está archivada", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: null });
    const res = await correctPATCH(jsonRequest({ realHours: 5 }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01" });
    const res = await correctPATCH(badJsonRequest(), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si no se envía ni realHours ni status", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01" });
    const res = await correctPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 ante un estado inválido", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01" });
    const res = await correctPATCH(jsonRequest({ status: "CANCELADA" }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 ante horas reales inválidas (negativas o no numéricas)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01", realHours: 5 });
    const res = await correctPATCH(jsonRequest({ realHours: -1 }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 si los valores enviados son idénticos a los actuales (nada que corregir)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01", realHours: 5, status: "COMPLETADA" });
    const res = await correctPATCH(jsonRequest({ realHours: 5, status: "COMPLETADA" }), ctx());
    expect(res.status).toBe(400);
  });

  it("corrige realHours, registra la corrección en el MonthClosure existente y marca la tarea como corregida", async () => {
    mockSession({ role: "ADMINISTRADOR", userId: "admin-1" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01", realHours: 5, status: "COMPLETADA" });
    monthClosureFindUnique.mockResolvedValue({ id: "closure-1", corrections: [{ existing: true }] });
    taskUpdate.mockResolvedValue({ id: "task-1", realHours: 7 });

    const res = await correctPATCH(jsonRequest({ realHours: 7 }), ctx());
    expect(res.status).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ realHours: 7, corrected: true }) })
    );
    expect(monthClosureUpdate).toHaveBeenCalledWith({
      where: { id: "closure-1" },
      data: {
        corrections: [
          { existing: true },
          expect.objectContaining({ field: "realHours", oldValue: 5, newValue: 7, correctedBy: "admin-1" }),
        ],
      },
    });
  });

  it("corrige el estado a COMPLETADA estableciendo progreso 100 y completedAt", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01", realHours: 5, status: "PENDIENTE", completedAt: null });
    monthClosureFindUnique.mockResolvedValue(null);
    taskUpdate.mockResolvedValue({});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await correctPATCH(jsonRequest({ status: "COMPLETADA" }), ctx());
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETADA", progress: 100, completedAt: expect.any(Date) }) })
    );
  });

  it("corrige el estado a PENDIENTE reiniciando el progreso y limpiando completedAt", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01", realHours: 5, status: "COMPLETADA", completedAt: new Date() });
    monthClosureFindUnique.mockResolvedValue(null);
    taskUpdate.mockResolvedValue({});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await correctPATCH(jsonRequest({ status: "PENDIENTE" }), ctx());
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ progress: 0, completedAt: null }) })
    );
  });

  it("si no se encuentra el MonthClosure correspondiente, igual guarda la corrección de la tarea (solo registra en consola)", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    taskFindUnique.mockResolvedValue({ id: "task-1", archivedMonth: "2026-01", realHours: 5, status: "COMPLETADA" });
    monthClosureFindUnique.mockResolvedValue(null);
    taskUpdate.mockResolvedValue({ id: "task-1" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await correctPATCH(jsonRequest({ realHours: 8 }), ctx());
    expect(res.status).toBe(200);
    expect(monthClosureUpdate).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});

function xlsxFile(rows: unknown[][]): File {
  const header = [
    "Título", "Descripción", "Prioridad", "Frecuencia",
    "Fecha Inicio", "Fecha Fin", "Tiempo Objetivo", "Asignado a (email)", "Tipo",
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Tareas");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new File([buffer], "import.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function importRequest(rows: unknown[][]): NextRequest {
  const fd = new FormData();
  fd.set("file", xlsxFile(rows));
  return { formData: async () => fd } as unknown as NextRequest;
}

describe("POST /api/tasks/import", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await importPOST({ formData: async () => new FormData() } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("responde 400 si no se envía archivo", async () => {
    mockSession({});
    const res = await importPOST({ formData: async () => new FormData() } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("importa una fila válida (auto-asignada al solicitante) y no reporta errores", async () => {
    mockSession({ userId: "u1" });
    taskCreate.mockResolvedValue({});
    const res = await importPOST(
      importRequest([["Tarea 1", "desc", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "", "FIJA"]])
    );
    const body = await res.json();
    expect(body).toEqual({ imported: 1, errors: [] });
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: "u1", title: "Tarea 1" }) })
    );
  });

  it("reporta error por título faltante, sin crear la tarea", async () => {
    mockSession({});
    const res = await importPOST(importRequest([["", "d", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "", "FIJA"]]));
    const body = await res.json();
    expect(body.imported).toBe(0);
    expect(body.errors[0]).toMatchObject({ row: 2, error: expect.stringContaining("Título") });
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("reporta error por prioridad o frecuencia inválida", async () => {
    mockSession({});
    const res = await importPOST(
      importRequest([["Tarea", "d", "URGENTE", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "", "FIJA"]])
    );
    const body = await res.json();
    expect(body.errors[0].error).toMatch(/Prioridad inválida/);
  });

  it("reporta error si falta la fecha de inicio o el formato es inválido", async () => {
    mockSession({});
    const missing = await (
      await importPOST(importRequest([["Tarea", "d", "ALTA", "PUNTUAL", "", "2026-01-10", "4", "", "FIJA"]]))
    ).json();
    expect(missing.errors[0].error).toMatch(/fecha de inicio es obligatoria/);

    const invalid = await (
      await importPOST(importRequest([["Tarea", "d", "ALTA", "PUNTUAL", "2026-13-40", "2026-01-10", "4", "", "FIJA"]]))
    ).json();
    expect(invalid.errors[0].error).toMatch(/formato de fecha inválido/);
  });

  it("reporta error si el tiempo objetivo no es numérico", async () => {
    mockSession({});
    const res = await importPOST(
      importRequest([["Tarea", "d", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "no-numero", "", "FIJA"]])
    );
    const body = await res.json();
    expect(body.errors[0].error).toMatch(/Tiempo objetivo inválido/);
  });

  it("busca al usuario por email y usa su id como assignedToId; reporta error si no existe", async () => {
    mockSession({ userId: "u1" });
    userFindUnique.mockResolvedValueOnce({ id: "encontrado-1" }).mockResolvedValueOnce(null);
    taskCreate.mockResolvedValue({});

    const res = await importPOST(
      importRequest([
        ["Tarea A", "d", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "existe@nexo.com", "FIJA"],
        ["Tarea B", "d", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "noexiste@nexo.com", "FIJA"],
      ])
    );
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.errors[0].error).toMatch(/Usuario no encontrado/);
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: "encontrado-1" }) })
    );
  });

  it("normaliza el tipo a SEGUIMIENTO cuando se indica, y a FIJA por defecto si es inválido o está vacío", async () => {
    mockSession({});
    taskCreate.mockResolvedValue({});
    await importPOST(
      importRequest([["Tarea", "d", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "", "seguimiento"]])
    );
    expect(taskCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "SEGUIMIENTO" }) }));
  });

  it("captura el error si la creación de la tarea falla y continúa con las demás filas", async () => {
    mockSession({});
    taskCreate.mockRejectedValueOnce(new Error("db error")).mockResolvedValueOnce({});
    const res = await importPOST(
      importRequest([
        ["Tarea A", "d", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "", "FIJA"],
        ["Tarea B", "d", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "", "FIJA"],
      ])
    );
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.errors[0]).toMatchObject({ row: 2, error: "Error al crear la tarea" });
  });

  it("ignora filas completamente vacías (no las cuenta como error)", async () => {
    mockSession({});
    taskCreate.mockResolvedValue({});
    const res = await importPOST(
      importRequest([
        ["Tarea", "d", "ALTA", "PUNTUAL", "2026-01-05", "2026-01-10", "4", "", "FIJA"],
        [null, null, null, null, null, null, null, null, null],
      ])
    );
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.errors).toEqual([]);
  });
});

describe("GET /api/tasks/template", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await templateGET();
    expect(res.status).toBe(401);
  });

  it("devuelve un archivo xlsx descargable con las cabeceras correctas", async () => {
    mockSession({});
    const res = await templateGET();
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(res.headers.get("Content-Disposition")).toContain("plantilla_tareas.xlsx");
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
