import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

const improvementIdeaFindUnique = vi.fn();
const improvementIdeaUpdate = vi.fn();
const ideaStatusHistoryCreate = vi.fn();
const notificationCreate = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();

const prismaMock = {
  improvementIdea: { findUnique: improvementIdeaFindUnique, update: improvementIdeaUpdate },
  ideaStatusHistory: { create: ideaStatusHistoryCreate },
  notification: { create: notificationCreate },
  user: { findUnique: userFindUnique, update: userUpdate },
  $transaction: vi.fn(async (fn: (tx: typeof prismaMock) => Promise<void>) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { getSession } = await import("@/lib/session");
const { PATCH } = await import("@/app/api/ideas/[id]/status/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "JEFE_NACIONAL",
          name: "Test",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function ctx(id = "idea-1") {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

type RawIdea = {
  id: string;
  title: string;
  status: string;
  authorId: string;
};

const FINAL_SELECT_RESULT = {
  id: "idea-1",
  title: "Idea final",
  status: "EN_REVISION",
  _count: { votes: 3 },
  votes: [],
};

function setupIdea(raw: RawIdea, finalResult: Record<string, unknown> = FINAL_SELECT_RESULT) {
  improvementIdeaFindUnique.mockImplementation(async (args: { select?: unknown }) => {
    if (args.select) return finalResult;
    return raw;
  });
}

function resetMocks() {
  improvementIdeaFindUnique.mockReset();
  improvementIdeaUpdate.mockReset().mockResolvedValue({});
  ideaStatusHistoryCreate.mockReset().mockResolvedValue({});
  notificationCreate.mockReset().mockResolvedValue({});
  userFindUnique.mockReset();
  userUpdate.mockReset().mockResolvedValue({});
}

describe("PATCH /api/ideas/[id]/status", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    resetMocks();
    mockSession({ role: "JEFE_NACIONAL" });
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de revisión de ideas (ASISTENTE_GH)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 403 para COORDINADOR_ZS (no está en CAN_REVIEW_IDEAS)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(403);
  });

  it("responde 404 si la idea no existe", async () => {
    improvementIdeaFindUnique.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 400 ante una acción inválida", async () => {
    setupIdea({ id: "idea-1", title: "Idea", status: "PROPUESTA", authorId: "author-1" });
    const res = await PATCH(patchRequest({ action: "DESTRUIR" }), ctx());
    expect(res.status).toBe(400);
  });

  it("responde 400 (no crashea) si el body no es JSON válido", async () => {
    setupIdea({ id: "idea-1", title: "Idea", status: "PROPUESTA", authorId: "author-1" });
    const badRequest = {
      json: async () => {
        throw new Error("invalid json");
      },
    } as unknown as NextRequest;
    const res = await PATCH(badRequest, ctx());
    expect(res.status).toBe(400);
  });

  describe("ADVANCE", () => {
    it("avanza PROPUESTA -> EN_REVISION, limpia el adjunto y notifica al autor", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "PROPUESTA", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      expect(res.status).toBe(200);

      expect(ideaStatusHistoryCreate).toHaveBeenCalledWith({
        data: { ideaId: "idea-1", fromStatus: "PROPUESTA", toStatus: "EN_REVISION", changedBy: "u1", comment: null },
      });
      expect(improvementIdeaUpdate).toHaveBeenCalledWith({
        where: { id: "idea-1" },
        data: { status: "EN_REVISION", attachmentUrl: null, attachmentData: null },
      });
      expect(notificationCreate).toHaveBeenCalledWith({
        data: { userId: "author-1", message: 'Tu idea "Mi idea" pasó a En revisión', taskTitle: "Mi idea" },
      });
    });

    it("no limpia el adjunto al avanzar desde un estado distinto de PROPUESTA", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "EN_REVISION", authorId: "author-1" });
      await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      expect(improvementIdeaUpdate).toHaveBeenCalledWith({
        where: { id: "idea-1" },
        data: { status: "APROBADA" },
      });
    });

    it("responde 400 al intentar avanzar desde IMPLEMENTADA (ya es el último estado)", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "IMPLEMENTADA", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      expect(res.status).toBe(400);
      expect(ideaStatusHistoryCreate).not.toHaveBeenCalled();
    });

    it("al llegar a IMPLEMENTADA, otorga la insignia 'innovador' al autor si no la tiene", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "EN_PRUEBAS", authorId: "author-1" });
      userFindUnique.mockResolvedValue({ badges: [] });

      const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      expect(res.status).toBe(200);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: "author-1" },
        data: { badges: { push: "innovador" } },
      });
      expect(notificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ message: expect.stringContaining("¡Felicidades!") }) })
      );
    });

    it("no duplica la insignia 'innovador' si el autor ya la tiene", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "EN_PRUEBAS", authorId: "author-1" });
      userFindUnique.mockResolvedValue({ badges: ["innovador"] });

      await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it("no consulta ni otorga insignias si el destino no es IMPLEMENTADA", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "PROPUESTA", authorId: "author-1" });
      await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      expect(userFindUnique).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
    });
  });

  describe("RETREAT", () => {
    it("responde 400 al intentar retroceder desde PROPUESTA (ya es el primer estado)", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "PROPUESTA", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "RETREAT" }), ctx());
      expect(res.status).toBe(400);
    });

    it("retrocede APROBADA -> EN_REVISION", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "APROBADA", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "RETREAT" }), ctx());
      expect(res.status).toBe(200);
      expect(ideaStatusHistoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fromStatus: "APROBADA", toStatus: "EN_REVISION" }) })
      );
    });
  });

  describe("REJECT", () => {
    it("responde 400 si la idea ya está IMPLEMENTADA (no se puede rechazar)", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "IMPLEMENTADA", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "REJECT", comment: "motivo" }), ctx());
      expect(res.status).toBe(400);
    });

    it("responde 400 si falta el motivo del rechazo", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "EN_REVISION", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "REJECT" }), ctx());
      expect(res.status).toBe(400);
      expect(ideaStatusHistoryCreate).not.toHaveBeenCalled();
    });

    it("responde 400 si el motivo del rechazo es solo espacios en blanco", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "EN_REVISION", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "REJECT", comment: "   " }), ctx());
      expect(res.status).toBe(400);
    });

    it("rechaza la idea con motivo, registra el historial y notifica con el motivo incluido", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "EN_REVISION", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "REJECT", comment: "  No cumple los requisitos  " }), ctx());
      expect(res.status).toBe(200);

      expect(ideaStatusHistoryCreate).toHaveBeenCalledWith({
        data: {
          ideaId: "idea-1",
          fromStatus: "EN_REVISION",
          toStatus: "RECHAZADA",
          changedBy: "u1",
          comment: "No cumple los requisitos",
        },
      });
      expect(notificationCreate).toHaveBeenCalledWith({
        data: {
          userId: "author-1",
          message: 'Tu idea "Mi idea" fue rechazada: No cumple los requisitos',
          taskTitle: "Mi idea",
        },
      });
    });
  });

  describe("REOPEN", () => {
    it("responde 400 si la idea no está RECHAZADA", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "EN_REVISION", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "REOPEN" }), ctx());
      expect(res.status).toBe(400);
    });

    it("reabre una idea RECHAZADA hacia EN_REVISION", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "RECHAZADA", authorId: "author-1" });
      const res = await PATCH(patchRequest({ action: "REOPEN" }), ctx());
      expect(res.status).toBe(200);
      expect(improvementIdeaUpdate).toHaveBeenCalledWith({
        where: { id: "idea-1" },
        data: { status: "EN_REVISION" },
      });
    });
  });

  describe("notificaciones y respuesta", () => {
    it("no notifica al autor si quien revisa la idea es el propio autor", async () => {
      setupIdea({ id: "idea-1", title: "Mi idea", status: "PROPUESTA", authorId: "u1" });
      await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      expect(notificationCreate).not.toHaveBeenCalled();
    });

    it("expone voteCount y votedByMe=true cuando el usuario actual ya votó", async () => {
      setupIdea(
        { id: "idea-1", title: "Mi idea", status: "PROPUESTA", authorId: "author-1" },
        { id: "idea-1", title: "Mi idea", status: "EN_REVISION", _count: { votes: 5 }, votes: [{ id: "v1" }] }
      );
      const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      const body = await res.json();
      expect(body.voteCount).toBe(5);
      expect(body.votedByMe).toBe(true);
    });

    it("expone votedByMe=false cuando el usuario actual no votó", async () => {
      setupIdea(
        { id: "idea-1", title: "Mi idea", status: "PROPUESTA", authorId: "author-1" },
        { id: "idea-1", title: "Mi idea", status: "EN_REVISION", _count: { votes: 0 }, votes: [] }
      );
      const res = await PATCH(patchRequest({ action: "ADVANCE" }), ctx());
      const body = await res.json();
      expect(body.votedByMe).toBe(false);
    });
  });
});
