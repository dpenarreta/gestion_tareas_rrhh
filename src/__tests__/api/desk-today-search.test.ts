import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// GET /api/desk/today y GET /api/desk/search pasaron de Prisma a Django
// (`DeskTodayView`/`DeskSearchView`, Fase 7f) — sin cobertura de Vitest
// previa. La lógica real (agregación de 4 bloques, filtros de búsqueda)
// ya vive en Django, cubierta en `backend/apps/desk/tests/`.
const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { GET: todayGET } = await import("@/app/api/desk/today/route");
const { GET: searchGET } = await import("@/app/api/desk/search/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  getSession.mockResolvedValue(
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

function getRequest(url: string): NextRequest {
  return { url } as unknown as NextRequest;
}

function resetAll() {
  getSession.mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/desk/today", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await todayGET();
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await todayGET();
    expect(res.status).toBe(401);
  });

  it("responde 403 para Administrador", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 403));
    const res = await todayGET();
    expect(res.status).toBe(403);
  });

  it("mapea los 4 bloques a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        pending_notes: [{ id: 1, message: "hola", priority: "INFORMACION", color: "AMARILLO", created_at: "2026-08-17T10:00:00Z", sender_name: "Bea" }],
        today_reminders: [{ id: 2, title: "Llamar", due_at: "2026-08-17T12:00:00Z", priority: "MEDIA", overdue: true }],
        upcoming_tasks: [{ id: 3, title: "Entregar", end_date: "2026-08-20T00:00:00Z", priority: "ALTA", status: "PENDIENTE" }],
        recent_projects: [{ id: 4, name: "Rediseño", status: "EN_EJECUCION", updated_at: "2026-08-17T09:00:00Z" }],
      })
    );

    const res = await todayGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingNotes).toEqual([{ id: "1", message: "hola", priority: "INFORMACION", color: "AMARILLO", createdAt: "2026-08-17T10:00:00Z", senderName: "Bea" }]);
    expect(body.todayReminders).toEqual([{ id: "2", title: "Llamar", dueAt: "2026-08-17T12:00:00Z", priority: "MEDIA", overdue: true }]);
    expect(body.upcomingTasks).toEqual([{ id: "3", title: "Entregar", endDate: "2026-08-20T00:00:00Z", priority: "ALTA", status: "PENDIENTE" }]);
    expect(body.recentProjects).toEqual([{ id: "4", name: "Rediseño", status: "EN_EJECUCION", updatedAt: "2026-08-17T09:00:00Z" }]);
  });
});

describe("GET /api/desk/search", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await searchGET(getRequest("http://localhost/api/desk/search"));
    expect(res.status).toBe(401);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await searchGET(getRequest("http://localhost/api/desk/search"));
    expect(res.status).toBe(401);
  });

  it("reenvía los filtros como query string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { notes: [], reminders: [] }));
    await searchGET(getRequest("http://localhost/api/desk/search?q=contrato&priority=URGENTE&date=2026-08-17&sender=bea&recipient=ana&status=PENDIENTE"));
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/desk/search/?q=contrato&priority=URGENTE&date=2026-08-17&sender=bea&recipient=ana&status=PENDIENTE"
    );
  });

  it("sin filtros, no agrega query string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { notes: [], reminders: [] }));
    await searchGET(getRequest("http://localhost/api/desk/search"));
    expect(djangoApiFetch).toHaveBeenCalledWith("/desk/search/");
  });

  it("mapea notas y recordatorios a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        notes: [
          {
            id: 1, message: "hola", priority: "INFORMACION", color: "AMARILLO", read: false, archived: false,
            created_at: "2026-08-17T10:00:00Z", sender_id: 2, sender_name: "Bea", recipient_id: 1, recipient_name: "Ana",
            is_mine: false, reply_count: 1,
          },
        ],
        reminders: [{ id: 3, title: "Llamar", description: null, due_at: "2026-08-17T12:00:00Z", priority: "MEDIA", status: "PENDIENTE" }],
      })
    );

    const res = await searchGET(getRequest("http://localhost/api/desk/search"));
    const body = await res.json();
    expect(body.notes).toEqual([
      {
        id: "1", message: "hola", priority: "INFORMACION", color: "AMARILLO", read: false, archived: false,
        createdAt: "2026-08-17T10:00:00Z", senderId: "2", senderName: "Bea", recipientId: "1", recipientName: "Ana",
        isMine: false, replyCount: 1,
      },
    ]);
    expect(body.reminders).toEqual([{ id: "3", title: "Llamar", description: null, dueAt: "2026-08-17T12:00:00Z", priority: "MEDIA", status: "PENDIENTE" }]);
  });
});
