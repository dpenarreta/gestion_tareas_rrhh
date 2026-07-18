import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const taskFindMany = vi.fn();
const userFindMany = vi.fn();
const documentChunkFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: taskFindMany },
    user: { findMany: userFindMany },
    documentChunk: { findMany: documentChunkFindMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

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

function resetAll() {
  taskFindMany.mockReset().mockResolvedValue([]);
  userFindMany.mockReset().mockResolvedValue([]);
  documentChunkFindMany.mockReset().mockResolvedValue([]);
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
    taskFindMany.mockResolvedValue([
      { title: "Tarea vencida", status: "PENDIENTE", priority: "ALTA", type: "FIJA", startDate: new Date("2026-01-01"), endDate: new Date("2020-01-01"), estimatedHours: 2, realHours: 1, progress: 0 },
    ]);
    await chatPOST(jsonRequest({ mode: "tasks", message: "¿Qué debo priorizar?" }));
    const systemMessage = groqCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemMessage).toContain("Vencidas: 1");
    expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { assignedToId: "u1" } }));
  });

  it("modo hr: para un rol de nivel 1 (sin equipo), el contexto no incluye sección de equipo", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    await chatPOST(jsonRequest({ mode: "hr", message: "¿Cómo manejo un conflicto?" }));
    const systemMessage = groqCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemMessage).not.toContain("EQUIPO A CARGO");
  });

  it("modo hr: incluye fuentes de documentos cuando hay chunks relevantes (score > 0.2)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    documentChunkFindMany.mockResolvedValue([
      { content: "Política de vacaciones...", pageNumber: 3, embedding: [1, 0, 0], document: { title: "Manual RRHH", fileName: "manual.pdf" } },
    ]);
    cosineSimilarity.mockReturnValue(0.9);

    const res = await chatPOST(jsonRequest({ mode: "hr", message: "¿Cuántos días de vacaciones tengo?" }));
    const body = await res.json();
    expect(body.sources).toEqual([{ title: "Manual RRHH", fileName: "manual.pdf", pageNumber: 3 }]);
  });

  it("modo hr: descarta chunks con score de similitud bajo (<=0.2)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    documentChunkFindMany.mockResolvedValue([
      { content: "Contenido poco relevante", pageNumber: 1, embedding: [0, 1, 0], document: { title: "Manual", fileName: "m.pdf" } },
    ]);
    cosineSimilarity.mockReturnValue(0.1);

    const res = await chatPOST(jsonRequest({ mode: "hr", message: "pregunta" }));
    const body = await res.json();
    expect(body.sources).toEqual([]);
  });

  it("modo hr: si buildTeamContext falla, no rompe la petición (se anota el error en el contexto)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    userFindMany.mockRejectedValue(new Error("fallo consultando equipo"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await chatPOST(jsonRequest({ mode: "hr", message: "pregunta" }));
    expect(res.status).toBe(200);
    const systemMessage = groqCreate.mock.calls[0][0].messages[0].content as string;
    expect(systemMessage).toContain("No se pudo cargar el contexto del equipo");
  });

  it("responde 500 si falla la construcción del contexto de tareas", async () => {
    mockSession({});
    taskFindMany.mockRejectedValue(new Error("db caída"));
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
