import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const commentCount = vi.fn();
const commentFindMany = vi.fn();
const taskActivityFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate },
    comment: { count: commentCount, findMany: commentFindMany },
    taskActivity: { findMany: taskActivityFindMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): `nova-message`
// pasó de Prisma (`task.findMany`/`computeCargaTiempo`) a Django
// (`fetchOwnDjangoTasks` + `GET /kpis/me/`).
const fetchOwnDjangoTasks = vi.fn();
vi.mock("@/lib/djangoTasksAdapter", () => ({
  fetchOwnDjangoTasks: (...a: unknown[]) => fetchOwnDjangoTasks(...a),
}));

const groqCreate = vi.fn();
class MockGroq {
  chat = { completions: { create: (...a: unknown[]) => groqCreate(...a) } };
}
vi.mock("groq-sdk", () => ({ default: MockGroq }));

const deleteFromGithub = vi.fn();
vi.mock("@/lib/githubDocuments", () => ({ deleteFromGithub: (...a: unknown[]) => deleteFromGithub(...a) }));

// GET /api/profile/badges pasó de Prisma a Django en el cutover de stack
// (ver docs/AUDIT_LOG.md § 2026-08-21): Tareas/Comentarios/Actividades (los
// insumos del cálculo) ya se escriben exclusivamente en Django.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

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

const NEUTRAL_KPI_PAYLOAD = { carga_tiempo: { diaria: { pct: 80, real_hours: 5, base_hours: 6.5, is_weekend: false } } };

function resetAll() {
  fetchOwnDjangoTasks.mockReset().mockResolvedValue([]);
  userFindUnique.mockReset();
  userUpdate.mockReset().mockResolvedValue({});
  commentCount.mockReset().mockResolvedValue(0);
  commentFindMany.mockReset().mockResolvedValue([]);
  taskActivityFindMany.mockReset().mockResolvedValue([]);
  deleteFromGithub.mockReset().mockResolvedValue(undefined);
  groqCreate.mockReset();
  vi.mocked(getSession).mockReset();
  djangoApiFetch.mockReset().mockResolvedValue(djangoResponse(true, NEUTRAL_KPI_PAYLOAD));
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
    fetchOwnDjangoTasks.mockResolvedValue([{ status: "PENDIENTE", end_date: new Date(2026, 6, 1).toISOString() }]);
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/vencida/);
    expect(body.cached).toBe(false);
  });

  it("si no hay vencidas, prioriza tareas por vencer esta semana", async () => {
    mockSession("nova-porvencer");
    fetchOwnDjangoTasks.mockResolvedValue([{ status: "PENDIENTE", end_date: new Date(2026, 7, 14).toISOString() }]);
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/próxima.*vencer|próximas.*vencer/);
  });

  it("sin vencidas/por vencer y con carga extrema entre semana, comenta la carga laboral", async () => {
    mockSession("nova-carga", { role: "ANALISTA_CC" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { carga_tiempo: { diaria: { pct: 150, real_hours: 9, base_hours: 6, is_weekend: false } } })
    );
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).toMatch(/carga laboral/);
  });

  it("roles de dirección (Administrador/Jefe Nacional) nunca reciben comentario de carga laboral individual", async () => {
    mockSession("nova-carga-liderazgo", { role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { carga_tiempo: { diaria: { pct: 150, real_hours: 9, base_hours: 6, is_weekend: false } } })
    );
    const res = await novaMessagePOST();
    const body = await res.json();
    expect(body.message).not.toMatch(/carga laboral/);
    expect(body.message).toMatch(/Bienvenido a Nexo/);
  });

  it("sin nada urgente, felicita por las tareas completadas del mes", async () => {
    mockSession("nova-completadas");
    fetchOwnDjangoTasks.mockResolvedValue([{ status: "COMPLETADA", end_date: new Date(2026, 7, 5).toISOString() }]);
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
    fetchOwnDjangoTasks.mockResolvedValue([{ status: "PENDIENTE", end_date: new Date(2026, 6, 1).toISOString() }]);

    const first = await novaMessagePOST();
    const firstBody = await first.json();
    expect(firstBody.cached).toBe(false);
    fetchOwnDjangoTasks.mockClear();

    const second = await novaMessagePOST();
    const secondBody = await second.json();
    expect(secondBody.cached).toBe(true);
    expect(secondBody.message).toBe(firstBody.message);
    expect(fetchOwnDjangoTasks).not.toHaveBeenCalled();
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

  // Cutover de stack: ruta puramente cosmética (saludo del Dashboard) — si
  // la sesión de Next.js todavía no tiene acceso a Django, se degrada al
  // saludo genérico en vez de fallar (criterio distinto al 401 usado en el
  // resto de la migración, ver docs/AUDIT_LOG.md § 2026-08-24).
  it("si Django no tiene tareas disponibles para esta sesión, degrada al saludo genérico (200, no error)", async () => {
    mockSession("nova-no-django");
    fetchOwnDjangoTasks.mockResolvedValue(null);
    const res = await novaMessagePOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/Bienvenido a Nexo/);
  });

  it("si Django no tiene la carga de tiempo disponible para esta sesión, degrada al saludo genérico (200, no error)", async () => {
    mockSession("nova-no-kpi");
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "no disponible" }, 401));
    const res = await novaMessagePOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/Bienvenido a Nexo/);
  });
});

describe("GET /api/profile/badges", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await badgesGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession("u1");
    djangoApiFetch.mockResolvedValue(null);
    const res = await badgesGET();
    expect(res.status).toBe(401);
  });

  it("devuelve el payload de Django tal cual (ya en camelCase)", async () => {
    mockSession("u1");
    const payload = {
      badges: [{ id: "cumplidor", icon: "🎯", name: "Cumplidor", description: "...", earned: true }],
      stats: { totalCompleted: 5, totalComments: 2, currentStreak: 3, earnedCount: 1 },
    };
    djangoApiFetch.mockResolvedValue(djangoResponse(true, payload));
    const res = await badgesGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    expect(djangoApiFetch).toHaveBeenCalledWith("/profile/badges/");
  });
});

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 58): esta ruta
// pasó de Prisma a Django (`apps.assistant`) — mockeado con `djangoApiFetch`,
// enrutado por método ya que el mismo detalle (`GET`) y el borrado
// (`DELETE`) comparten la misma URL `/assistant/documents/<id>/`.
describe("DELETE /api/assistant/documents/[id]", () => {
  beforeEach(resetAll);

  function mockDoc(doc: { github_path: string | null; github_sha: string | null } | null) {
    djangoApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== "/assistant/documents/doc-1/") throw new Error(`ruta Django no mockeada: ${url}`);
      if (init?.method === "DELETE") return djangoResponse(true, { ok: true });
      if (!doc) return djangoResponse(false, { error: "no encontrado" }, 404);
      return djangoResponse(true, { id: 1, title: "Manual", ...doc });
    });
  }

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
    mockDoc(null);
    const res = await documentDELETE(undefined as never, ctx());
    expect(res.status).toBe(404);
  });

  it("elimina también el archivo de GitHub cuando hay path/sha registrados", async () => {
    mockSession("u1", { role: "ADMINISTRADOR" });
    mockDoc({ github_path: "docs/doc-1.pdf", github_sha: "sha123" });
    const res = await documentDELETE(undefined as never, ctx());
    expect(res.status).toBe(200);
    expect(deleteFromGithub).toHaveBeenCalledWith("docs/doc-1.pdf", "sha123");
    expect(djangoApiFetch).toHaveBeenCalledWith("/assistant/documents/doc-1/", { method: "DELETE" });
  });

  it("no falla si eliminar de GitHub rechaza (se captura y continúa)", async () => {
    mockSession("u1", { role: "ADMINISTRADOR" });
    mockDoc({ github_path: "docs/doc-1.pdf", github_sha: "sha123" });
    deleteFromGithub.mockRejectedValue(new Error("GitHub no disponible"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await documentDELETE(undefined as never, ctx());
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/assistant/documents/doc-1/", { method: "DELETE" });
  });

  it("no intenta eliminar de GitHub si el documento no tiene path/sha (falló antes de subir)", async () => {
    mockSession("u1", { role: "ADMINISTRADOR" });
    mockDoc({ github_path: null, github_sha: null });
    await documentDELETE(undefined as never, ctx());
    expect(deleteFromGithub).not.toHaveBeenCalled();
  });
});
