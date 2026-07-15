import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const taskFindMany = vi.fn();
const taskCount = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const commentCount = vi.fn();
const commentFindMany = vi.fn();
const taskActivityFindMany = vi.fn();
const knowledgeDocumentFindUnique = vi.fn();
const knowledgeDocumentDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: taskFindMany, count: taskCount },
    user: { findUnique: userFindUnique, update: userUpdate },
    comment: { count: commentCount, findMany: commentFindMany },
    taskActivity: { findMany: taskActivityFindMany },
    knowledgeDocument: { findUnique: knowledgeDocumentFindUnique, delete: knowledgeDocumentDelete },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const computeCargaTiempo = vi.fn();
vi.mock("@/lib/workload", () => ({ computeCargaTiempo: (...a: unknown[]) => computeCargaTiempo(...a) }));

const groqCreate = vi.fn();
class MockGroq {
  chat = { completions: { create: (...a: unknown[]) => groqCreate(...a) } };
}
vi.mock("groq-sdk", () => ({ default: MockGroq }));

const deleteFromGithub = vi.fn();
vi.mock("@/lib/githubDocuments", () => ({ deleteFromGithub: (...a: unknown[]) => deleteFromGithub(...a) }));

const { getSession } = await import("@/lib/session");
const { POST: novaMessagePOST } = await import("@/app/api/dashboard/nova-message/route");
const { GET: badgesGET } = await import("@/app/api/profile/badges/route");
const { DELETE: documentDELETE } = await import("@/app/api/assistant/documents/[id]/route");

function mockSession(userId: string, overrides: Partial<SessionPayload> = {}) {
  vi.mocked(getSession).mockResolvedValue({
    userId,
    role: "ADMINISTRADOR",
    name: "Ana",
    email: "test@nexo.com",
    expiresAt: new Date(Date.now() + 100000).toISOString(),
    ...overrides,
  });
}

function ctx(id = "doc-1") {
  return { params: Promise.resolve({ id }) };
}

const NEUTRAL_CARGA = { diaria: { pct: 80, realHours: 5, baseHours: 6.5, isWeekend: false } };

function resetAll() {
  taskFindMany.mockReset().mockResolvedValue([]);
  taskCount.mockReset();
  userFindUnique.mockReset();
  userUpdate.mockReset().mockResolvedValue({});
  commentCount.mockReset().mockResolvedValue(0);
  commentFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  knowledgeDocumentFindUnique.mockReset();
  knowledgeDocumentDelete.mockReset().mockResolvedValue({});
  deleteFromGithub.mockReset().mockResolvedValue(undefined);
  computeCargaTiempo.mockReset().mockResolvedValue(NEUTRAL_CARGA);
  groqCreate.mockReset();
  vi.mocked(getSession).mockReset();
  delete process.env.GROQ_API_KEY;
}

describe("POST /api/dashboard/nova-message", () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 10, 0, 0)); // miércoles
  });
  afterEach(() => vi.useRealTimers());

  it("responde 401 si no hay sesión", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await novaMessagePOST();
    expect(res.status).toBe(401);
  });

  it("prioriza el mensaje de tareas vencidas cuando existen", async () => {
    mockSession("nova-overdue");
    taskFindMany.mockResolvedValue([{ status: "PENDIENTE", endDate: new Date("2026-07-01") }]);
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/vencida/);
    expect(body.cached).toBe(false);
  });

  it("si no hay vencidas, prioriza tareas por vencer esta semana", async () => {
    mockSession("nova-porvencer");
    taskFindMany.mockResolvedValue([{ status: "PENDIENTE", endDate: new Date(2026, 7, 14) }]);
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/próxima.*vencer|próximas.*vencer/);
  });

  it("sin vencidas/por vencer y con carga extrema entre semana, comenta la carga laboral", async () => {
    mockSession("nova-carga");
    computeCargaTiempo.mockResolvedValue({ diaria: { pct: 150, realHours: 9, baseHours: 6, isWeekend: false } });
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/carga laboral/);
  });

  it("sin nada urgente, felicita por las tareas completadas del mes", async () => {
    mockSession("nova-completadas");
    taskFindMany.mockResolvedValue([{ status: "COMPLETADA", endDate: new Date(2026, 7, 5) }]);
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/Buen ritmo/);
  });

  it("sin ningún dato destacable, muestra el mensaje de bienvenida por defecto", async () => {
    mockSession("nova-default");
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/Bienvenido a Nexo/);
  });

  it("responde el mensaje cacheado en llamadas repetidas dentro del TTL, sin recalcular", async () => {
    mockSession("nova-cache");
    taskFindMany.mockResolvedValue([{ status: "PENDIENTE", endDate: new Date("2026-07-01") }]);

    const first = await novaMessagePOST();
    const firstBody = await first.json();
    expect(firstBody.cached).toBe(false);
    taskFindMany.mockClear();

    const second = await novaMessagePOST();
    const secondBody = await second.json();
    expect(secondBody.cached).toBe(true);
    expect(secondBody.message).toBe(firstBody.message);
    expect(taskFindMany).not.toHaveBeenCalled();
  });

  it("con GROQ_API_KEY configurada, usa el mensaje generado por la IA", async () => {
    mockSession("nova-ai-ok");
    process.env.GROQ_API_KEY = "test-key";
    groqCreate.mockResolvedValue({ choices: [{ message: { content: "  Mensaje generado por IA  " } }] });
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toBe("Mensaje generado por IA");
    expect(body.cached).toBe(false);
  });

  it("si la llamada a Groq falla, recae en el mensaje de respaldo", async () => {
    mockSession("nova-ai-fail");
    process.env.GROQ_API_KEY = "test-key";
    groqCreate.mockRejectedValue(new Error("Groq caído"));
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/Bienvenido a Nexo/);
  });
});

describe("GET /api/profile/badges", () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("responde 401 si no hay sesión", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await badgesGET();
    expect(res.status).toBe(401);
  });

  it("otorga 'Cumplidor' y 'Confiable' con 100% de cumplimiento del mes", async () => {
    mockSession("u1");
    userFindUnique.mockResolvedValue({ badges: [], createdAt: new Date("2025-01-01") });
    taskFindMany.mockResolvedValue([
      { status: "COMPLETADA", endDate: new Date(2026, 7, 5) },
      { status: "COMPLETADA", endDate: new Date(2026, 7, 10) },
    ]);
    taskCount.mockResolvedValue(2);

    const res = await badgesGET();
    const body = await res.json();
    const byId = Object.fromEntries(body.badges.map((b: { id: string; earned: boolean }) => [b.id, b.earned]));
    expect(byId.cumplidor).toBe(true);
    expect(byId.confiable).toBe(true);
    expect(byId.innovador).toBe(false);
  });

  it("otorga 'Colaborador' con 20+ comentarios totales", async () => {
    mockSession("u1");
    userFindUnique.mockResolvedValue({ badges: [], createdAt: new Date() });
    commentCount.mockResolvedValue(25);

    const res = await badgesGET();
    const body = await res.json();
    const byId = Object.fromEntries(body.badges.map((b: { id: string; earned: boolean }) => [b.id, b.earned]));
    expect(byId.colaborador).toBe(true);
  });

  it("'Innovador' refleja la insignia ya persistida, no se recalcula", async () => {
    mockSession("u1");
    userFindUnique.mockResolvedValue({ badges: ["innovador"], createdAt: new Date() });

    const res = await badgesGET();
    const body = await res.json();
    const byId = Object.fromEntries(body.badges.map((b: { id: string; earned: boolean }) => [b.id, b.earned]));
    expect(byId.innovador).toBe(true);
  });

  it("no actualiza la base de datos si las insignias ganadas ya estaban registradas", async () => {
    mockSession("u1");
    userFindUnique.mockResolvedValue({ badges: ["innovador"], createdAt: new Date() });
    // Sin tareas/comentarios/actividades: solo se mantiene 'innovador' (ya persistida).
    await badgesGET();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("actualiza la base de datos cuando se gana una insignia nueva", async () => {
    mockSession("u1");
    userFindUnique.mockResolvedValue({ badges: [], createdAt: new Date() });
    commentCount.mockResolvedValue(25); // gana 'colaborador'

    await badgesGET();
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { badges: ["colaborador"] } });
  });
});

describe("DELETE /api/assistant/documents/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await documentDELETE(undefined as never, ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de administración de la base de conocimiento", async () => {
    mockSession("u1", { role: "JEFE_NACIONAL" });
    const res = await documentDELETE(undefined as never, ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si el documento no existe", async () => {
    mockSession("u1", { role: "ADMINISTRADOR" });
    knowledgeDocumentFindUnique.mockResolvedValue(null);
    const res = await documentDELETE(undefined as never, ctx());
    expect(res.status).toBe(404);
  });

  it("elimina también el archivo de GitHub cuando hay path/sha registrados", async () => {
    mockSession("u1", { role: "ADMINISTRADOR" });
    knowledgeDocumentFindUnique.mockResolvedValue({ id: "doc-1", githubPath: "docs/doc-1.pdf", githubSha: "sha123" });
    const res = await documentDELETE(undefined as never, ctx());
    expect(res.status).toBe(200);
    expect(deleteFromGithub).toHaveBeenCalledWith("docs/doc-1.pdf", "sha123");
    expect(knowledgeDocumentDelete).toHaveBeenCalledWith({ where: { id: "doc-1" } });
  });

  it("no falla si eliminar de GitHub rechaza (se captura y continúa)", async () => {
    mockSession("u1", { role: "ADMINISTRADOR" });
    knowledgeDocumentFindUnique.mockResolvedValue({ id: "doc-1", githubPath: "docs/doc-1.pdf", githubSha: "sha123" });
    deleteFromGithub.mockRejectedValue(new Error("GitHub no disponible"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await documentDELETE(undefined as never, ctx());
    expect(res.status).toBe(200);
    expect(knowledgeDocumentDelete).toHaveBeenCalled();
  });

  it("no intenta eliminar de GitHub si el documento no tiene path/sha (falló antes de subir)", async () => {
    mockSession("u1", { role: "ADMINISTRADOR" });
    knowledgeDocumentFindUnique.mockResolvedValue({ id: "doc-1", githubPath: null, githubSha: null });
    await documentDELETE(undefined as never, ctx());
    expect(deleteFromGithub).not.toHaveBeenCalled();
  });
});
