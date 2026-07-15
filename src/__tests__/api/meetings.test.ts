import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

const meetingFindMany = vi.fn();
const meetingFindUnique = vi.fn();
const meetingCreate = vi.fn();
const meetingUpdate = vi.fn();
const meetingDelete = vi.fn();
const notificationCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: { findMany: meetingFindMany, findUnique: meetingFindUnique, create: meetingCreate, update: meetingUpdate, delete: meetingDelete },
    notification: { createMany: notificationCreateMany },
  },
}));

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const createZoomMeeting = vi.fn();
vi.mock("@/lib/zoom", () => ({ createZoomMeeting: (...args: unknown[]) => createZoomMeeting(...args) }));

const { getSession } = await import("@/lib/session");
const { GET: meetingsGET, POST: meetingsPOST } = await import("@/app/api/meetings/route");
const { GET: meetingGET, PATCH: meetingPATCH, DELETE: meetingDELETE } = await import("@/app/api/meetings/[id]/route");

const MEETING_FIXTURE = {
  id: "m1",
  title: "Reunión",
  description: null,
  hostId: "u1",
  meetingDate: new Date("2026-08-01T15:00:00Z"),
  duration: 40,
  zoomMeetingId: "123",
  zoomJoinUrl: "https://zoom.us/j/123",
  zoomPassword: "ABC123",
  status: "PROGRAMADA",
  otterInvited: false,
  otterSummary: null,
  otterTranscriptUrl: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  host: { id: "u1", name: "Ana", role: "JEFE_NACIONAL" },
  invitees: [],
};

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "JEFE_NACIONAL",
          name: "Ana",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function ctx(id = "m1") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function resetAll() {
  meetingFindMany.mockReset();
  meetingFindUnique.mockReset();
  meetingCreate.mockReset();
  meetingUpdate.mockReset();
  meetingDelete.mockReset();
  notificationCreateMany.mockReset().mockResolvedValue({});
  createZoomMeeting.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET /api/meetings", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingsGET();
    expect(res.status).toBe(401);
  });

  it("consulta reuniones donde el usuario es anfitrión o invitado, y serializa fechas a ISO", async () => {
    mockSession({});
    meetingFindMany.mockResolvedValue([MEETING_FIXTURE]);
    const res = await meetingsGET();
    expect(meetingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ hostId: "u1" }, { invitees: { some: { userId: "u1" } } }] },
      })
    );
    const body = await res.json();
    expect(body[0].meetingDate).toBe("2026-08-01T15:00:00.000Z");
  });
});

describe("POST /api/meetings", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingsPOST(jsonRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de creación de reuniones", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await meetingsPOST(jsonRequest({}));
    expect(res.status).toBe(403);
  });

  it("responde 400 si el body no es JSON válido", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const badRequest = { json: async () => { throw new Error("bad"); } } as never;
    const res = await meetingsPOST(badRequest);
    expect(res.status).toBe(400);
  });

  it("responde 400 si faltan campos requeridos", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await meetingsPOST(jsonRequest({ title: "Reunión" }));
    expect(res.status).toBe(400);
  });

  it("crea la reunión con Zoom real, notifica a los invitados (excluyendo al propio anfitrión) y no expone advertencia", async () => {
    mockSession({ userId: "u1" });
    createZoomMeeting.mockResolvedValue({ zoomMeetingId: "999", zoomJoinUrl: "https://zoom.us/j/999", zoomPassword: "XYZ" });
    meetingCreate.mockResolvedValue({ ...MEETING_FIXTURE, id: "m2" });

    const res = await meetingsPOST(
      jsonRequest({ title: "Reunión", meetingDate: "2026-08-01T15:00:00Z", duration: 30, inviteeIds: ["inv-1", "inv-2", "u1"] })
    );
    expect(res.status).toBe(201);

    expect(meetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zoomMeetingId: "999",
          invitees: { create: [{ userId: "inv-1" }, { userId: "inv-2" }] },
        }),
      })
    );
    expect(notificationCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: "inv-1" }),
        expect.objectContaining({ userId: "inv-2" }),
      ],
    });
    const body = await res.json();
    expect(body.zoomWarning).toBeNull();
  });

  it("si Zoom falla, genera un enlace simulado, marca zoomWarning y aun así crea la reunión", async () => {
    mockSession({});
    createZoomMeeting.mockRejectedValue(new Error("Zoom caído"));
    meetingCreate.mockResolvedValue({ ...MEETING_FIXTURE, id: "m3" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await meetingsPOST(jsonRequest({ title: "Reunión", meetingDate: "2026-08-01T15:00:00Z", duration: 30 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.zoomWarning).toMatch(/enlace simulado/);
    expect(meetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ zoomJoinUrl: expect.stringContaining("https://zoom.us/j/") }) })
    );
  });

  it("sin invitados, no crea invitees ni notificaciones", async () => {
    mockSession({});
    createZoomMeeting.mockResolvedValue({ zoomMeetingId: "1", zoomJoinUrl: "url", zoomPassword: "pw" });
    meetingCreate.mockResolvedValue({ ...MEETING_FIXTURE, id: "m4" });

    await meetingsPOST(jsonRequest({ title: "Reunión", meetingDate: "2026-08-01T15:00:00Z", duration: 30 }));
    expect(meetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invitees: undefined }) })
    );
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });

  it("responde 500 ante un error inesperado al crear la reunión", async () => {
    mockSession({});
    createZoomMeeting.mockResolvedValue({ zoomMeetingId: "1", zoomJoinUrl: "url", zoomPassword: "pw" });
    meetingCreate.mockRejectedValue(new Error("db error"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await meetingsPOST(jsonRequest({ title: "Reunión", meetingDate: "2026-08-01T15:00:00Z", duration: 30 }));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/meetings/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la reunión no existe", async () => {
    mockSession({});
    meetingFindUnique.mockResolvedValue(null);
    const res = await meetingGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si el usuario no es anfitrión ni invitado", async () => {
    mockSession({ userId: "ajeno" });
    meetingFindUnique.mockResolvedValue({ ...MEETING_FIXTURE, hostId: "otro", invitees: [{ userId: "otro-invitado" }] });
    const res = await meetingGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("un invitado (no anfitrión) puede ver la reunión", async () => {
    mockSession({ userId: "invitado-1" });
    meetingFindUnique.mockResolvedValue({ ...MEETING_FIXTURE, hostId: "otro", invitees: [{ userId: "invitado-1" }] });
    const res = await meetingGET(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/meetings/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la reunión no existe", async () => {
    mockSession({});
    meetingFindUnique.mockResolvedValue(null);
    const res = await meetingPATCH(jsonRequest({}), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien edita no es el anfitrión", async () => {
    mockSession({ userId: "invitado-1" });
    meetingFindUnique.mockResolvedValue({ hostId: "otro" });
    const res = await meetingPATCH(jsonRequest({ title: "x" }), ctx());
    expect(res.status).toBe(403);
  });

  it("solo actualiza los campos permitidos, convirtiendo meetingDate a Date", async () => {
    mockSession({ userId: "u1" });
    meetingFindUnique.mockResolvedValue({ hostId: "u1" });
    meetingUpdate.mockResolvedValue(MEETING_FIXTURE);

    await meetingPATCH(
      jsonRequest({ title: "Nuevo título", meetingDate: "2026-09-01T10:00:00Z", noPermitido: "x" }),
      ctx()
    );
    expect(meetingUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { title: "Nuevo título", meetingDate: new Date("2026-09-01T10:00:00Z") },
      include: expect.anything(),
    });
  });
});

describe("DELETE /api/meetings/[id]", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await meetingDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(401);
  });

  it("responde 404 si la reunión no existe", async () => {
    mockSession({});
    meetingFindUnique.mockResolvedValue(null);
    const res = await meetingDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(404);
  });

  it("responde 403 si quien elimina no es el anfitrión", async () => {
    mockSession({ userId: "invitado-1" });
    meetingFindUnique.mockResolvedValue({ hostId: "otro" });
    const res = await meetingDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(403);
  });

  it("el anfitrión puede eliminar la reunión", async () => {
    mockSession({ userId: "u1" });
    meetingFindUnique.mockResolvedValue({ hostId: "u1" });
    meetingDelete.mockResolvedValue({});
    const res = await meetingDELETE(jsonRequest(undefined), ctx());
    expect(res.status).toBe(200);
  });
});
