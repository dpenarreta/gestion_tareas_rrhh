import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 58): el
// contexto de tareas/equipo/base de conocimiento pasó de Prisma a Django —
// mockeado con `@/lib/djangoSession`, mismo patrón que `team.test.ts`. El
// cálculo de embeddings/similitud y la llamada a Groq siguen sin cambios.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const getEmbedding = vi.fn();
const cosineSimilarity = vi.fn();
vi.mock("@/lib/embeddings", () => ({
  getEmbedding: (...a: unknown[]) => getEmbedding(...a),
  cosineSimilarity: (...a: unknown[]) => cosineSimilarity(...a),
}));

const groqCreate = vi.fn();
class MockGroq {
  chat = { completions: { create: (...a: unknown[]) => groqCreate(...a) } };
}
vi.mock("groq-sdk", () => ({ default: MockGroq }));

const { getSession } = await import("@/lib/session");
const { POST: chatPOST } = await import("@/app/api/assistant/chat/route");

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

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function badJsonRequest() {
  return { json: async () => { throw new Error("bad"); } } as never;
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

/** Enruta `djangoApiFetch` por URL exacta — `/tasks/`, `/team/`,
 * `/team/<id>/tasks/` y `/assistant/chunks/` se llaman dentro de la misma
 * petición según el modo, a diferencia de los mocks por-tabla de Prisma
 * que existían antes de la Fase 58. */
function mockDjangoRoutes(routes: Record<string, unknown>) {
  djangoApiFetch.mockImplementation(async (url: string) => {
    if (url in routes) return djangoResponse(true, routes[url]);
    return djangoResponse(true, []);
  });
}

function resetAll() {
  djangoApiFetch.mockReset();
  mockDjangoRoutes({});
  getEmbedding.mockReset().mockResolvedValue([1, 0, 0]);
  cosineSimilarity.mockReset().mockReturnValue(0);
  groqCreate.mockReset().mockResolvedValue({ choices: [{ message: { content: "Respuesta de Nova" } }], usage: { total_tokens: 100 } });
  vi.mocked(getSession).mockReset();
  process.env.GROQ_API_KEY = "test-key";
}

describe("POST /api/assistant/chat", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await chatPOST(jsonRequest({ mode: "general", message: "hola" }));
    expect(res.status).toBe(401);
  });

  it("responde 503 si no hay GROQ_API_KEY configurada", async () => {
    mockSession({});
    delete process.env.GROQ_API_KEY;
    const res = await chatPOST(jsonRequest({ mode: "general", message: "hola" }));
    expect(res.status).toBe(503);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await chatPOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("responde 400 si el mensaje está vacío", async () => {
    mockSession({});
    const res = await chatPOST(jsonRequest({ mode: "general", message: "   " }));
    expect(res.status).toBe(400);
  });

  it("modo general: responde con el contenido de Groq, sin fuentes", async () => {
    mockSession({});
    const res = await chatPOST(jsonRequest({ mode: "general", message: "¿Qué es Nexo?" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ content: "Respuesta de Nova", sources: [] });
  });

  it("modo tasks: construye el contexto de tareas del usuario (incluye el conteo de vencidas)", async () => {
    mockSession({ userId: "u1" });
    mockDjangoRoutes({
      "/tasks/": [
        { title: "Tarea vencida", status: "PENDIENTE", priority: "ALTA", type: "FIJA", start_date: "2026-01-01", end_date: "2020-01-01", estimated_hours: 2, real_hours: 1, progress: 0 },
      ],
    });
    await chatPOST(jsonRequest({ mode: "tasks", message: "¿Qué debo priorizar?" }));
    const systemMessage = groqCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemMessage).toContain("Vencidas: 1");
    expect(djangoApiFetch).toHaveBeenCalledWith("/tasks/");
  });

  it("modo hr: para un rol de nivel 1 (sin equipo), el contexto no incluye sección de equipo", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    await chatPOST(jsonRequest({ mode: "hr", message: "¿Cómo manejo un conflicto?" }));
    const systemMessage = groqCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemMessage).not.toContain("EQUIPO A CARGO");
  });

  it("modo hr: incluye fuentes de documentos cuando hay chunks relevantes (score > 0.2)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    mockDjangoRoutes({
      "/team/": [],
      "/assistant/chunks/": [
        { content: "Política de vacaciones...", page_number: 3, embedding: [1, 0, 0], doc_title: "Manual RRHH", doc_file_name: "manual.pdf" },
      ],
    });
    cosineSimilarity.mockReturnValue(0.9);

    const res = await chatPOST(jsonRequest({ mode: "hr", message: "¿Cuántos días de vacaciones tengo?" }));
    const body = await res.json();
    expect(body.sources).toEqual([{ title: "Manual RRHH", fileName: "manual.pdf", pageNumber: 3 }]);
  });

  it("modo hr: descarta chunks con score de similitud bajo (<=0.2)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    mockDjangoRoutes({
      "/team/": [],
      "/assistant/chunks/": [
        { content: "Contenido poco relevante", page_number: 1, embedding: [0, 1, 0], doc_title: "Manual", doc_file_name: "m.pdf" },
      ],
    });
    cosineSimilarity.mockReturnValue(0.1);

    const res = await chatPOST(jsonRequest({ mode: "hr", message: "pregunta" }));
    const body = await res.json();
    expect(body.sources).toEqual([]);
  });

  it("modo hr: si buildTeamContext falla, no rompe la petición (se anota el error en el contexto)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockImplementation(async (url: string) => {
      if (url === "/team/") return djangoResponse(false, { error: "fallo consultando equipo" }, 500);
      return djangoResponse(true, []);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await chatPOST(jsonRequest({ mode: "hr", message: "pregunta" }));
    expect(res.status).toBe(200);
    const systemMessage = groqCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemMessage).toContain("No se pudo cargar el contexto del equipo");
  });

  it("responde 500 si falla la construcción del contexto de tareas (sin sesión Django disponible)", async () => {
    mockSession({});
    djangoApiFetch.mockImplementation(async (url: string) => {
      if (url === "/tasks/") return djangoResponse(false, { error: "db caída" }, 500);
      return djangoResponse(true, []);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await chatPOST(jsonRequest({ mode: "tasks", message: "pregunta" }));
    expect(res.status).toBe(500);
  });

  it("responde 422 si Groq falla por límite de contexto/tokens", async () => {
    mockSession({});
    groqCreate.mockRejectedValue(new Error("context_length_exceeded: too many tokens"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await chatPOST(jsonRequest({ mode: "general", message: "pregunta muy larga" }));
    expect(res.status).toBe(422);
  });

  it("responde 502 ante cualquier otro error de Groq", async () => {
    mockSession({});
    groqCreate.mockRejectedValue(new Error("network error"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await chatPOST(jsonRequest({ mode: "general", message: "pregunta" }));
    expect(res.status).toBe(502);
  });

  it("incluye el historial de la conversación en los mensajes enviados a Groq", async () => {
    mockSession({});
    await chatPOST(
      jsonRequest({
        mode: "general",
        message: "y ahora?",
        history: [{ role: "user", content: "hola" }, { role: "assistant", content: "hola, ¿en qué ayudo?" }],
      })
    );
    const messages = groqCreate.mock.calls[0][0].messages;
    expect(messages).toHaveLength(4); // system + 2 historial + mensaje actual
    expect(messages[1]).toEqual({ role: "user", content: "hola" });
    expect(messages[3]).toEqual({ role: "user", content: "y ahora?" });
  });
});
