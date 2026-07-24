import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const taskFindMany = vi.fn();
const projectFindMany = vi.fn();
const projectPhaseFindMany = vi.fn();
const projectParticipantFindMany = vi.fn();
const activityReasonFindMany = vi.fn();
const taskActivityFindMany = vi.fn();
const projectActivityFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: (...a: unknown[]) => taskFindMany(...a) },
    project: { findMany: (...a: unknown[]) => projectFindMany(...a) },
    projectPhase: { findMany: (...a: unknown[]) => projectPhaseFindMany(...a) },
    projectParticipant: { findMany: (...a: unknown[]) => projectParticipantFindMany(...a) },
    activityReason: { findMany: (...a: unknown[]) => activityReasonFindMany(...a) },
    taskActivity: { findMany: (...a: unknown[]) => taskActivityFindMany(...a) },
    projectActivity: { findMany: (...a: unknown[]) => projectActivityFindMany(...a) },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: dataQualityGET } = await import("@/app/api/settings/data-quality/route");

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

function resetAll() {
  taskFindMany.mockReset().mockResolvedValue([]);
  projectFindMany.mockReset().mockResolvedValue([]);
  projectPhaseFindMany.mockReset().mockResolvedValue([]);
  projectParticipantFindMany.mockReset().mockResolvedValue([]);
  activityReasonFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  projectActivityFindMany.mockReset().mockResolvedValue([]);
  vi.mocked(getSession).mockReset();
}

describe("GET /api/settings/data-quality", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await dataQualityGET();
    expect(res.status).toBe(401);
  });

  it("responde 403 si el rol no es Administrador", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await dataQualityGET();
    expect(res.status).toBe(403);
  });

  it("responde 0 hallazgos cuando los datos están sanos", async () => {
    mockSession({});
    taskFindMany.mockResolvedValue([
      { id: "t1", title: "Tarea", startDate: new Date("2026-01-01"), endDate: new Date("2026-01-05"), progress: 50, realHours: 3, estimatedHours: 5, assignedToId: "u1" },
    ]);
    const res = await dataQualityGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalIssues).toBe(0);
    expect(body.checks.every((c: { count: number }) => c.count === 0)).toBe(true);
  });

  it("detecta una tarea con endDate anterior a startDate", async () => {
    mockSession({});
    taskFindMany.mockResolvedValue([
      { id: "t1", title: "Tarea invertida", startDate: new Date("2026-01-10"), endDate: new Date("2026-01-05"), progress: 0, realHours: 0, estimatedHours: 1, assignedToId: "u1" },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "fechas_invalidas");
    expect(check.count).toBe(1);
    expect(check.items[0].label).toContain("Tarea invertida");
  });

  it("detecta progreso fuera de rango", async () => {
    mockSession({});
    taskFindMany.mockResolvedValue([
      { id: "t1", title: "Tarea rara", startDate: new Date("2026-01-01"), endDate: new Date("2026-01-05"), progress: 150, realHours: 0, estimatedHours: 1, assignedToId: "u1" },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "calculos_fuera_de_rango");
    expect(check.count).toBe(1);
  });

  it("detecta horas solapadas entre una actividad de Tarea y una de Proyecto, mismo autor y día", async () => {
    mockSession({});
    const day = new Date("2026-06-15T13:00:00.000Z");
    taskActivityFindMany.mockResolvedValue([
      { id: "a1", authorId: "u1", startTime: "09:00", endTime: "10:00", createdAt: day, duration: 60, task: { title: "Tarea X" }, author: { name: "Ana" } },
    ]);
    projectActivityFindMany.mockResolvedValue([
      { id: "a2", authorId: "u1", startTime: "09:30", endTime: "10:30", createdAt: day, duration: 60, project: { name: "Proyecto Y" }, author: { name: "Ana" } },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "horas_duplicadas");
    expect(check.count).toBe(2);
  });

  it("no marca solapamiento entre actividades de autores distintos el mismo día", async () => {
    mockSession({});
    const day = new Date("2026-06-15T13:00:00.000Z");
    taskActivityFindMany.mockResolvedValue([
      { id: "a1", authorId: "u1", startTime: "09:00", endTime: "10:00", createdAt: day, duration: 60, task: { title: "Tarea X" }, author: { name: "Ana" } },
    ]);
    projectActivityFindMany.mockResolvedValue([
      { id: "a2", authorId: "u2", startTime: "09:30", endTime: "10:30", createdAt: day, duration: 60, project: { name: "Proyecto Y" }, author: { name: "Beto" } },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "horas_duplicadas");
    expect(check.count).toBe(0);
  });

  it("detecta un participante sin usuario asociado", async () => {
    mockSession({});
    projectParticipantFindMany.mockResolvedValue([
      { id: "p1", userId: "", project: { name: "Proyecto Z" } },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "sin_propietario");
    expect(check.count).toBe(1);
    expect(check.items[0].label).toContain("Proyecto Z");
  });

  it("detecta una actividad con un motivo que no existe en el catálogo", async () => {
    mockSession({});
    activityReasonFindMany.mockResolvedValue([{ key: "REUNION" }]);
    taskActivityFindMany.mockResolvedValue([
      { id: "a1", authorId: "u1", startTime: null, endTime: null, createdAt: new Date(), duration: 30, reason: "MOTIVO_ELIMINADO", isRetroactive: false, activityDate: null, task: { title: "Tarea X" }, author: { name: "Ana" } },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "motivo_huerfano");
    expect(check.count).toBe(1);
    expect(check.items[0].label).toContain("MOTIVO_ELIMINADO");
  });

  it("no marca un motivo que sí existe en el catálogo", async () => {
    mockSession({});
    activityReasonFindMany.mockResolvedValue([{ key: "REUNION" }]);
    taskActivityFindMany.mockResolvedValue([
      { id: "a1", authorId: "u1", startTime: null, endTime: null, createdAt: new Date(), duration: 30, reason: "REUNION", isRetroactive: false, activityDate: null, task: { title: "Tarea X" }, author: { name: "Ana" } },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "motivo_huerfano");
    expect(check.count).toBe(0);
  });

  it("detecta un registro marcado retroactivo sin activityDate", async () => {
    mockSession({});
    taskActivityFindMany.mockResolvedValue([
      { id: "a1", authorId: "u1", startTime: null, endTime: null, createdAt: new Date("2026-06-10T12:00:00Z"), duration: 30, reason: "REUNION", isRetroactive: true, activityDate: null, task: { title: "Tarea X" }, author: { name: "Ana" } },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "retroactivo_inconsistente");
    expect(check.count).toBe(1);
    expect(check.items[0].label).toContain("sin fecha");
  });

  it("detecta un registro no marcado retroactivo cuya activityDate difiere de createdAt", async () => {
    mockSession({});
    projectActivityFindMany.mockResolvedValue([
      {
        id: "a1",
        authorId: "u1",
        startTime: null,
        endTime: null,
        createdAt: new Date("2026-06-10T12:00:00Z"),
        duration: 30,
        isRetroactive: false,
        activityDate: new Date("2026-06-05T05:00:00Z"),
        project: { name: "Proyecto X" },
        author: { name: "Ana" },
      },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "retroactivo_inconsistente");
    expect(check.count).toBe(1);
    expect(check.items[0].label).toContain("sin marcar como retroactiva");
  });

  it("no marca un registro retroactivo correctamente marcado y con fecha", async () => {
    mockSession({});
    taskActivityFindMany.mockResolvedValue([
      { id: "a1", authorId: "u1", startTime: null, endTime: null, createdAt: new Date("2026-06-10T12:00:00Z"), duration: 30, reason: "REUNION", isRetroactive: true, activityDate: new Date("2026-06-08T00:00:00Z"), task: { title: "Tarea X" }, author: { name: "Ana" } },
    ]);
    const res = await dataQualityGET();
    const body = await res.json();
    const check = body.checks.find((c: { key: string }) => c.key === "retroactivo_inconsistente");
    expect(check.count).toBe(0);
  });
});
