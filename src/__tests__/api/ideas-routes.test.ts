import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const improvementIdeaFindMany = vi.fn();
const improvementIdeaFindUnique = vi.fn();
const improvementIdeaCreate = vi.fn();
const improvementIdeaUpdate = vi.fn();
const ideaStatusHistoryFindMany = vi.fn();
const ideaVoteFindUnique = vi.fn();
const ideaVoteCreate = vi.fn();
const ideaVoteDelete = vi.fn();
const ideaVoteCount = vi.fn();
const userFindMany = vi.fn();
const notificationCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    improvementIdea: { findMany: improvementIdeaFindMany, findUnique: improvementIdeaFindUnique, create: improvementIdeaCreate, update: improvementIdeaUpdate },
    ideaStatusHistory: { findMany: ideaStatusHistoryFindMany },
    ideaVote: { findUnique: ideaVoteFindUnique, create: ideaVoteCreate, delete: ideaVoteDelete, count: ideaVoteCount },
    user: { findMany: userFindMany },
    notification: { createMany: notificationCreateMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const getVisibleIdeaAuthorIds = vi.fn();
vi.mock("@/lib/ideas", () => ({
  getVisibleIdeaAuthorIds: (...args: unknown[]) => getVisibleIdeaAuthorIds(...args),
}));

vi.mock("@/lib/storage", () => {
  class AttachmentError extends Error {}
  return { saveAttachment: vi.fn(), AttachmentError };
});

const { getSession } = await import("@/lib/session");
const { saveAttachment, AttachmentError } = await import("@/lib/storage");
const { GET: ideasGET, POST: ideasPOST } = await import("@/app/api/ideas/route");
const { GET: ideaGET, PATCH: ideaPATCH } = await import("@/app/api/ideas/[id]/route");
const { GET: historyGET } = await import("@/app/api/ideas/[id]/history/route");
const { POST: votePOST } = await import("@/app/api/ideas/[id]/vote/route");

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

function ctx(id = "idea-1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function resetAll() {
  improvementIdeaFindMany.mockReset();
  improvementIdeaFindUnique.mockReset();
  improvementIdeaCreate.mockReset();
  improvementIdeaUpdate.mockReset();
  ideaStatusHistoryFindMany.mockReset();
  ideaVoteFindUnique.mockReset();
  ideaVoteCreate.mockReset().mockResolvedValue({});
  ideaVoteDelete.mockReset().mockResolvedValue({});
  ideaVoteCount.mockReset();
  userFindMany.mockReset();
  notificationCreateMany.mockReset().mockResolvedValue({});
  vi.mocked(getSession).mockReset();
  vi.mocked(getVisibleIdeaAuthorIds).mockReset().mockResolvedValue(["u1"]);
  vi.mocked(saveAttachment).mockReset();
}

describe("GET /api/ideas", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await ideasGET();
    expect(res.status).toBe(401);
  });

  it("filtra por los autores visibles y mapea el último rechazo/voteCount/votedByMe", async () => {
    mockSession({});
    getVisibleIdeaAuthorIds.mockResolvedValue(["u1", "u2"]);
    improvementIdeaFindMany.mockResolvedValue([
      {
        id: "idea-1",
        title: "Idea",
        history: [{ comment: "no cumple" }],
        _count: { votes: 3 },
        votes: [{ id: "v1" }],
      },
    ]);
    const res = await ideasGET();
    expect(improvementIdeaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorId: { in: ["u1", "u2"] } } })
    );
    const body = await res.json();
    expect(body[0]).toMatchObject({ latestRejectionComment: "no cumple", voteCount: 3, votedByMe: true });
  });

  it("latestRejectionComment es null si no hay historial de rechazo", async () => {
    mockSession({});
    improvementIdeaFindMany.mockResolvedValue([{ id: "idea-1", history: [], _count: { votes: 0 }, votes: [] }]);
    const res = await ideasGET();
    const body = await res.json();
    expect(body[0].latestRejectionComment).toBeNull();
  });
});

function ideaFormData(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("POST /api/ideas", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await ideasPOST({ formData: async () => new FormData() } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("responde 400 si faltan campos o el impacto es inválido", async () => {
    mockSession({});
    const res = await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "URGENTE" }),
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("crea la idea sin adjunto cuando no se envía archivo", async () => {
    mockSession({ userId: "u1", name: "Ana" });
    improvementIdeaCreate.mockResolvedValue({ id: "idea-1", title: "Idea", _count: { votes: 0 }, votes: [] });
    userFindMany.mockResolvedValue([]);

    const res = await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "ALTO" }),
    } as unknown as NextRequest);
    expect(res.status).toBe(201);
    expect(improvementIdeaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attachmentUrl: null, attachmentData: null }) })
    );
  });

  it("adjunta el archivo cuando se sube uno válido", async () => {
    mockSession({});
    vi.mocked(saveAttachment).mockResolvedValue({ fileName: "adjunto.pdf", attachmentData: "data:application/pdf;base64,xxx" });
    improvementIdeaCreate.mockResolvedValue({ id: "idea-1", _count: { votes: 0 }, votes: [] });
    userFindMany.mockResolvedValue([]);

    const file = new File([new Uint8Array(10)], "adjunto.pdf", { type: "application/pdf" });
    await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "ALTO", file }),
    } as unknown as NextRequest);

    expect(improvementIdeaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attachmentUrl: "adjunto.pdf", attachmentData: "data:application/pdf;base64,xxx" }),
      })
    );
  });

  it("responde 400 si el adjunto no pasa la validación de storage (AttachmentError)", async () => {
    mockSession({});
    vi.mocked(saveAttachment).mockRejectedValue(new AttachmentError("Tipo de archivo no permitido"));
    const file = new File([new Uint8Array(10)], "malware.exe", { type: "application/octet-stream" });

    const res = await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "ALTO", file }),
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Tipo de archivo no permitido");
    expect(improvementIdeaCreate).not.toHaveBeenCalled();
  });

  it("relanza errores inesperados de storage que no son AttachmentError", async () => {
    mockSession({});
    vi.mocked(saveAttachment).mockRejectedValue(new Error("fallo inesperado"));
    const file = new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" });
    await expect(
      ideasPOST({
        formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "ALTO", file }),
      } as unknown as NextRequest)
    ).rejects.toThrow("fallo inesperado");
  });

  it("notifica a los revisores (ADMINISTRADOR/JEFE_NACIONAL/COORDINADOR_NACIONAL) si existen", async () => {
    mockSession({ name: "Ana" });
    improvementIdeaCreate.mockResolvedValue({ id: "idea-1", _count: { votes: 0 }, votes: [] });
    userFindMany.mockResolvedValue([{ id: "rev-1" }, { id: "rev-2" }]);

    await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea nueva", description: "desc", impact: "ALTO" }),
    } as unknown as NextRequest);

    expect(notificationCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: "rev-1", message: expect.stringContaining("Idea nueva") }),
        expect.objectContaining({ userId: "rev-2" }),
      ],
    });
  });

  it("no notifica si no hay revisores", async () => {
    mockSession({});
    improvementIdeaCreate.mockResolvedValue({ id: "idea-1", _count: { votes: 0 }, votes: [] });
    userFindMany.mockResolvedValue([]);
    await ideasPOST({
      formData: async () => ideaFormData({ title: "Idea", description: "desc", impact: "ALTO" }),
    } as unknown as NextRequest);
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/ideas/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await ideaGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la idea no existe", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue(null);
    const res = await ideaGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 404 si el autor de la idea no está dentro de los IDs visibles (IDOR)", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue({ id: "idea-1", author: { id: "autor-oculto" }, status: "PROPUESTA" });
    getVisibleIdeaAuthorIds.mockResolvedValue(["u1"]);
    const res = await ideaGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("expone el adjunto cuando la idea está en estado PROPUESTA", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue({
      id: "idea-1",
      author: { id: "u1" },
      status: "PROPUESTA",
      attachmentUrl: "a.pdf",
      attachmentData: "data:...",
      _count: { votes: 0 },
      votes: [],
    });
    const res = await ideaGET(jsonRequest(undefined), ctx());
    const body = await res.json();
    expect(body.attachmentUrl).toBe("a.pdf");
  });

  it("oculta el adjunto cuando la idea ya avanzó de estado (no es PROPUESTA)", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue({
      id: "idea-1",
      author: { id: "u1" },
      status: "EN_REVISION",
      attachmentUrl: "a.pdf",
      attachmentData: "data:...",
      _count: { votes: 0 },
      votes: [],
    });
    const res = await ideaGET(jsonRequest(undefined), ctx());
    const body = await res.json();
    expect(body.attachmentUrl).toBeNull();
    expect(body.attachmentData).toBeNull();
  });
});

describe("PATCH /api/ideas/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await ideaPATCH(jsonRequest({ progress: 50 }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de revisión de ideas", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await ideaPATCH(jsonRequest({ progress: 50 }), ctx());
    expect(res.status).toBe(403);
  });

  it.each([undefined, 50.5, -1, 101, "50"])("responde 400 ante un progreso inválido: %p", async (progress) => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await ideaPATCH(jsonRequest({ progress }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 404 si la idea no existe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    improvementIdeaFindUnique.mockResolvedValue(null);
    const res = await ideaPATCH(jsonRequest({ progress: 50 }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 404 (IDOR) si el autor no está en la jerarquía visible", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    improvementIdeaFindUnique.mockResolvedValue({ id: "idea-1", authorId: "autor-oculto" });
    getVisibleIdeaAuthorIds.mockResolvedValue(["otro"]);
    const res = await ideaPATCH(jsonRequest({ progress: 50 }), ctx());
    expect(res.status).toBe(404);
  });

  it("actualiza el progreso y devuelve voteCount/votedByMe", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    improvementIdeaFindUnique.mockResolvedValue({ id: "idea-1", authorId: "u1" });
    getVisibleIdeaAuthorIds.mockResolvedValue(["u1"]);
    improvementIdeaUpdate.mockResolvedValue({ id: "idea-1", progress: 75, _count: { votes: 2 }, votes: [] });

    const res = await ideaPATCH(jsonRequest({ progress: 75 }), ctx());
    expect(res.status).toBe(200);
    expect(improvementIdeaUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { progress: 75 } }));
    const body = await res.json();
    expect(body).toMatchObject({ progress: 75, voteCount: 2, votedByMe: false });
  });
});

describe("GET /api/ideas/[id]/history", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await historyGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la idea no existe", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue(null);
    const res = await historyGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 404 (IDOR) fuera de la jerarquía visible", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue({ authorId: "autor-oculto" });
    getVisibleIdeaAuthorIds.mockResolvedValue(["otro"]);
    const res = await historyGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("devuelve el historial ordenado ascendentemente", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue({ authorId: "u1" });
    ideaStatusHistoryFindMany.mockResolvedValue([{ id: "h1" }]);
    const res = await historyGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
    expect(ideaStatusHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ideaId: "idea-1" }, orderBy: { createdAt: "asc" } })
    );
  });
});

describe("POST /api/ideas/[id]/vote", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await votePOST(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la idea no existe", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue(null);
    const res = await votePOST(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 404 (IDOR) fuera de la jerarquía visible", async () => {
    mockSession({});
    improvementIdeaFindUnique.mockResolvedValue({ id: "idea-1", authorId: "autor-oculto" });
    getVisibleIdeaAuthorIds.mockResolvedValue(["otro"]);
    const res = await votePOST(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("crea el voto si el usuario aún no había votado, y responde votedByMe=true", async () => {
    mockSession({ userId: "u1" });
    improvementIdeaFindUnique.mockResolvedValue({ id: "idea-1", authorId: "u1" });
    ideaVoteFindUnique.mockResolvedValue(null);
    ideaVoteCount.mockResolvedValue(4);

    const res = await votePOST(jsonRequest(undefined), ctx());
    expect(ideaVoteCreate).toHaveBeenCalledWith({ data: { ideaId: "idea-1", userId: "u1" } });
    expect(ideaVoteDelete).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ voteCount: 4, votedByMe: true });
  });

  it("elimina el voto existente (toggle) y responde votedByMe=false", async () => {
    mockSession({ userId: "u1" });
    improvementIdeaFindUnique.mockResolvedValue({ id: "idea-1", authorId: "u1" });
    ideaVoteFindUnique.mockResolvedValue({ id: "vote-existing" });
    ideaVoteCount.mockResolvedValue(3);

    const res = await votePOST(jsonRequest(undefined), ctx());
    expect(ideaVoteDelete).toHaveBeenCalledWith({ where: { id: "vote-existing" } });
    expect(ideaVoteCreate).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual({ voteCount: 3, votedByMe: false });
  });
});
