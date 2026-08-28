import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// GET /api/dashboard pasó a Django en el cutover de stack (Fase 51, ver
// docs/AUDIT_LOG.md § 2026-08-24) — mockeado con `@/lib/djangoSession`, el
// cálculo real (tareas prioritarias, actividad de área, alertas de equipo,
// comunicados, reuniones, proyectos) ya vive en `build_dashboard_payload`
// (backend, Fase 25), cubierto en `backend/apps/dashboard/tests/`. Acá solo
// se prueba ruteo/mapeo de ids numéricos a `string`. PATCH
// /api/dashboard/card-order se cortó en la Fase 55 (ver docs/AUDIT_LOG.md §
// 2026-08-25) — ya no toca Prisma.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { getSession } = await import("@/lib/session");
const { GET: dashboardGET } = await import("@/app/api/dashboard/route");
const { PATCH: cardOrderPATCH } = await import("@/app/api/dashboard/card-order/route");

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

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

function resetAll() {
  djangoApiFetch.mockReset();
  vi.mocked(getSession).mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const MINIMAL_DASHBOARD_PAYLOAD = {
  workloadPct: 0,
  completedPct: 0,
  overdue: 0,
  priorityTasks: [],
  stats: { today: { pending: 0, inProgress: 0, completed: 0 }, week: { pending: 0, inProgress: 0, completed: 0 }, month: { pending: 0, inProgress: 0, completed: 0 } },
  areaActivity: [],
  teamAlerts: 0,
  welcomeMessage: "",
  welcomeMessageActive: false,
  announcements: [],
  lastLoginAt: null,
  badges: [],
  upcomingMeetings: [],
  myProjects: [],
};

describe("GET /api/dashboard", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await dashboardGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await dashboardGET();
    expect(res.status).toBe(401);
  });

  it("propaga el status de error de Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, {}, 500));
    const res = await dashboardGET();
    expect(res.status).toBe(500);
  });

  it("reenvía a /dashboard/ y devuelve el payload tal cual cuando no hay ids que convertir", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, MINIMAL_DASHBOARD_PAYLOAD));
    const res = await dashboardGET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/dashboard/");
    const body = await res.json();
    expect(body).toEqual(MINIMAL_DASHBOARD_PAYLOAD);
  });

  it("convierte los ids numéricos de priorityTasks/announcements/upcomingMeetings/myProjects a string", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        ...MINIMAL_DASHBOARD_PAYLOAD,
        priorityTasks: [{ id: 5, title: "Vencida", status: "PENDIENTE", endDate: "2026-08-01", urgency: 4 }],
        announcements: [{ id: 1, title: "Aviso", content: "c", pinned: true, expiresAt: "2026-09-01", createdAt: "2026-08-01", authorName: "Ana" }],
        upcomingMeetings: [{ id: 2, title: "Futura", meetingDate: "2026-09-01", duration: 30, status: "PROGRAMADA", hostName: "Beto" }],
        myProjects: [{ id: 3, name: "Proyecto X", status: "EN_CURSO", priority: "ALTA", targetDate: "2026-10-01" }],
      })
    );
    const res = await dashboardGET();
    const body = await res.json();
    expect(body.priorityTasks[0].id).toBe("5");
    expect(body.announcements[0].id).toBe("1");
    expect(body.upcomingMeetings[0].id).toBe("2");
    expect(body.myProjects[0].id).toBe("3");
  });
});

describe("PATCH /api/dashboard/card-order", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await cardOrderPATCH(jsonRequest({ order: ["a"] }));
    expect(res.status).toBe(401);
  });

  it("responde 400 si order no es un array no vacío", async () => {
    mockSession({});
    expect((await cardOrderPATCH(jsonRequest({ order: [] }))).status).toBe(400);
    expect((await cardOrderPATCH(jsonRequest({ order: "a,b" }))).status).toBe(400);
  });

  it("responde 401 si la sesión de Next.js todavía no tiene acceso a Django", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await cardOrderPATCH(jsonRequest({ order: ["carga"] }));
    expect(res.status).toBe(401);
  });

  it("reenvía el nuevo orden a Django", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { ok: true }));
    const res = await cardOrderPATCH(jsonRequest({ order: ["carga", "tareas", "reuniones"] }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/dashboard/card-order/", {
      method: "PATCH",
      body: JSON.stringify({ order: ["carga", "tareas", "reuniones"] }),
    });
  });

  it("propaga un error de validación de Django", async () => {
    mockSession({ userId: "u1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "order debe ser un array no vacío" }, 400));
    const res = await cardOrderPATCH(jsonRequest({ order: ["carga"] }));
    expect(res.status).toBe(400);
  });
});
