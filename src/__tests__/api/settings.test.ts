import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

// GET/PUT /api/settings/retention-policy y GET/POST .../purge pasaron a
// Django en el cutover de stack (Fase 83, ver docs/AUDIT_LOG.md §
// 2026-08-27) — mockeados con `@/lib/djangoSession` como el resto de las
// rutas de este archivo, ya no con `@/lib/retentionPolicy` (Prisma,
// eliminado en esa misma fase). La limpieza de GitHub post-purga
// (`deleteFromGithub`) se mockea aparte para que el POST no dispare un
// fetch real.
const deleteFromGithub = vi.fn();
vi.mock("@/lib/githubDocuments", () => ({ deleteFromGithub: (...a: unknown[]) => deleteFromGithub(...a) }));

// GET/POST /api/settings/login-attempts/cleanup pasó de `@/lib/rate-limit`
// (Postgres) a Django en el cutover de stack (ver docs/AUDIT_LOG.md §
// 2026-08-21): el login real ya resuelve el rate limiting del lado Django
// desde la Fase 6a, así que el `LoginAttempt` de Postgres que este endpoint
// purgaba ya no recibía escrituras.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
  extractDjangoFlatErrorMessage: async (response: Response) => (await response.json().catch(() => null))?.error,
}));

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: retentionGET, PUT: retentionPUT } = await import("@/app/api/settings/retention-policy/route");
const { GET: purgeGET, POST: purgePOST } = await import("@/app/api/settings/retention-policy/purge/route");
const { GET: workloadGET, PUT: workloadPUT } = await import("@/app/api/settings/workload-config/route");
const { GET: loginAttemptsCleanupGET, POST: loginAttemptsCleanupPOST } = await import(
  "@/app/api/settings/login-attempts/cleanup/route"
);
const { GET: welcomeMessageGET, PUT: welcomeMessagePUT } = await import("@/app/api/settings/welcome-message/route");
const { GET: notificationRulesGET, PUT: notificationRulesPUT } = await import(
  "@/app/api/settings/notification-rules/route"
);

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ADMINISTRADOR",
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
  deleteFromGithub.mockReset().mockResolvedValue(undefined);
  djangoApiFetch.mockReset();
  vi.mocked(getSession).mockReset();
}

describe("GET/PUT /api/settings/retention-policy", () => {
  beforeEach(resetAll);

  it("GET responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await retentionGET();
    expect(res.status).toBe(401);
  });

  it("GET devuelve la política efectiva vigente, mapeada a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { monthly_reports_months: "24", archived_tasks_months: "24", knowledge_docs_months: "indefinite" })
    );
    const res = await retentionGET();
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/retention-policy/");
    const body = await res.json();
    expect(body.monthlyReportsMonths).toBe("24");
  });

  it("PUT responde 403 para un rol no Administrador, sin llamar a Django", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await retentionPUT(jsonRequest({}));
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("PUT responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await retentionPUT(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("PUT propaga un mensaje de validación de Django ante una opción inválida", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "monthly_reports_months inválido" }, 400));
    const res = await retentionPUT(jsonRequest({ monthlyReportsMonths: "999" }));
    expect(res.status).toBe(400);
  });

  it("PUT reenvía solo los campos provistos, traducidos a snake_case", async () => {
    mockSession({ userId: "admin-1" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { monthly_reports_months: "24", archived_tasks_months: "12", knowledge_docs_months: "indefinite" })
    );
    await retentionPUT(jsonRequest({ archivedTasksMonths: "12" }));
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/retention-policy/", {
      method: "PUT",
      body: JSON.stringify({ archived_tasks_months: "12" }),
    });
  });
});

describe("GET/POST /api/settings/retention-policy/purge", () => {
  beforeEach(resetAll);

  it("GET responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await purgeGET()).status).toBe(401);
    mockSession({ role: "JEFE_NACIONAL" });
    expect((await purgeGET()).status).toBe(403);
  });

  it("GET devuelve la vista previa de candidatos a depurar", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { reportsToDelete: 2, tasksToDelete: 1, docsToDelete: 0 }));
    const res = await purgeGET();
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/retention-policy/purge/");
    const body = await res.json();
    expect(body).toEqual({ reportsToDelete: 2, tasksToDelete: 1, docsToDelete: 0 });
  });

  it("POST responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await purgePOST(jsonRequest({}))).status).toBe(401);
    mockSession({ role: "JEFE_NACIONAL" });
    expect((await purgePOST(jsonRequest({}))).status).toBe(403);
  });

  it("POST responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await purgePOST(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("POST responde 400 sin confirmación explícita, sin llamar a Django", async () => {
    mockSession({});
    const res = await purgePOST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("POST ejecuta la depuración con confirm=true y limpia GitHub best-effort", async () => {
    mockSession({ userId: "admin-1" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, {
        reportsDeleted: 2,
        tasksDeleted: 1,
        docsDeleted: 1,
        deletedDocs: [{ githubPath: "docs/a.pdf", githubSha: "sha1" }],
      })
    );
    const res = await purgePOST(jsonRequest({ confirm: true }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/retention-policy/purge/", { method: "POST" });
    expect(deleteFromGithub).toHaveBeenCalledWith("docs/a.pdf", "sha1");
    const body = await res.json();
    // deletedDocs es interno (limpieza de GitHub) — nunca se reenvía al frontend.
    expect(body).toEqual({ reportsDeleted: 2, tasksDeleted: 1, docsDeleted: 1 });
  });
});

describe("GET/POST /api/settings/login-attempts/cleanup", () => {
  beforeEach(resetAll);

  it("GET responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await loginAttemptsCleanupGET()).status).toBe(401);
    mockSession({ role: "JEFE_NACIONAL" });
    expect((await loginAttemptsCleanupGET()).status).toBe(403);
  });

  it("GET devuelve el conteo de intentos expirados sin borrar nada", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { expired_count: 7 }));
    const res = await loginAttemptsCleanupGET();
    const body = await res.json();
    expect(body).toEqual({ expiredCount: 7 });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/login-attempts/cleanup/");
  });

  it("POST responde 401/403 según sesión y rol", async () => {
    mockSession(null);
    expect((await loginAttemptsCleanupPOST()).status).toBe(401);
    mockSession({ role: "COORDINADOR_NACIONAL" });
    expect((await loginAttemptsCleanupPOST()).status).toBe(403);
  });

  it("POST ejecuta la limpieza y devuelve la cantidad eliminada", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { deleted: 4 }));
    const res = await loginAttemptsCleanupPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: 4 });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/login-attempts/cleanup/", { method: "POST" });
  });
});

// GET/PUT /api/settings/workload-config pasó a Django en el cutover de
// stack (Fase 52, ver docs/AUDIT_LOG.md § 2026-08-24) — mockeado con
// `@/lib/djangoSession`. Ya consumida por el bundle de Analytics/Dashboard
// desde la Fase 4m — esta config editada desde Ajustes no tenía ningún
// efecto real hasta este cutover (gap preexistente, cerrado acá). El
// cálculo/validación real ya lo cubre la suite de Django.
describe("GET/PUT /api/settings/workload-config", () => {
  beforeEach(resetAll);

  it("GET responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await workloadGET();
    expect(res.status).toBe(401);
  });

  it("GET devuelve los 4 valores efectivos, mapeados a camelCase", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { hours_per_day: 6.5, workload_limit_low: 5.5, workload_limit_high: 7.5, workload_limit_overload: 8.5 })
    );
    const res = await workloadGET();
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/workload-config/");
    const body = await res.json();
    expect(body).toEqual({ hoursPerDay: 6.5, workloadLimitLow: 5.5, workloadLimitHigh: 7.5, workloadLimitOverload: 8.5 });
  });

  it("PUT responde 403 para un rol no Administrador, sin llamar a Django", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await workloadPUT(jsonRequest({}));
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("PUT responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await workloadPUT(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("PUT propaga un mensaje de validación de Django (ej. orden de límites)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(
      djangoResponse(false, { error: "Los límites deben mantener el orden: Subutilización (6.5) < Horas efectivas (6.5) <= Límite óptimo (7.5) < Sobrecarga (8.5)" }, 400)
    );
    const res = await workloadPUT(jsonRequest({ workloadLimitLow: 6.5 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/deben mantener el orden/);
  });

  it("PUT reenvía solo los campos provistos, traducidos a snake_case, y devuelve los valores efectivos mapeados", async () => {
    mockSession({ userId: "admin-1" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { hours_per_day: 7, workload_limit_low: 5.5, workload_limit_high: 7.5, workload_limit_overload: 8.5 })
    );
    const res = await workloadPUT(jsonRequest({ hoursPerDay: 7 }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/workload-config/", {
      method: "PUT",
      body: JSON.stringify({ hours_per_day: 7 }),
    });
    const body = await res.json();
    expect(body.hoursPerDay).toBe(7);
  });
});

// GET/PUT /api/settings/welcome-message pasó a Django en el cutover de
// stack (Fase 51, ver docs/AUDIT_LOG.md § 2026-08-24) — mockeado con
// `@/lib/djangoSession`. Se cortó junto con `GET /api/dashboard` en la
// misma fase (el Dashboard ya leía este mensaje de Django) para no dejar
// una escritura en Postgres desincronizada de una lectura en SQL Server.
describe("GET/PUT /api/settings/welcome-message", () => {
  beforeEach(resetAll);

  it("GET responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await welcomeMessageGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("GET devuelve el mensaje efectivo — accesible para cualquier usuario autenticado, no solo Administrador", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { message: "Bienvenidos al nuevo mes", active: true }));
    const res = await welcomeMessageGET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/welcome-message/");
    const body = await res.json();
    expect(body).toEqual({ message: "Bienvenidos al nuevo mes", active: true });
  });

  it("PUT responde 401/403 según sesión y rol, sin llamar a Django", async () => {
    mockSession(null);
    expect((await welcomeMessagePUT(jsonRequest({ message: "x", active: true }))).status).toBe(401);
    mockSession({ role: "COORDINADOR_NACIONAL" });
    expect((await welcomeMessagePUT(jsonRequest({ message: "x", active: true }))).status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("PUT responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await welcomeMessagePUT(badJsonRequest());
    expect(res.status).toBe(400);
  });

  it("PUT responde 400 si message o active tienen tipo incorrecto, sin llamar a Django", async () => {
    mockSession({});
    expect((await welcomeMessagePUT(jsonRequest({ message: 123, active: true }))).status).toBe(400);
    expect((await welcomeMessagePUT(jsonRequest({ message: "x", active: "true" }))).status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("PUT reenvía message/active a Django y devuelve la respuesta", async () => {
    mockSession({ userId: "admin-1" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, { message: "Hola equipo", active: true }));
    const res = await welcomeMessagePUT(jsonRequest({ message: "  Hola equipo  ", active: true }));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/welcome-message/", {
      method: "PUT",
      body: JSON.stringify({ message: "  Hola equipo  ", active: true }),
    });
    const body = await res.json();
    expect(body).toEqual({ message: "Hola equipo", active: true });
  });

  it("PUT propaga el mensaje de error plano de Django", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Datos inválidos" }, 400));
    const res = await welcomeMessagePUT(jsonRequest({ message: "", active: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Datos inválidos");
  });
});

// GET/PUT /api/settings/notification-rules pasó a Django en el cutover de
// stack (Fase 86, ver docs/AUDIT_LOG.md § 2026-08-28) — mockeado con
// `@/lib/djangoSession`, mismo patrón que `welcome-message`. La validación
// de forma (roles válidos, los 3 campos obligatorios) ahora la hace Django
// (`validate_notification_rules_body`, con su propia cobertura en
// `backend/apps/configuration/tests`) — este `route.ts` solo la propaga.
describe("GET/PUT /api/settings/notification-rules", () => {
  beforeEach(resetAll);

  it("GET responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await notificationRulesGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("GET devuelve la configuración vigente para cualquier usuario autenticado", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { comment_targets: {}, first_comment_role: null, retroactive_notify_roles: ["COORDINADOR_NACIONAL"] })
    );
    const res = await notificationRulesGET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/notification-rules/");
    const body = await res.json();
    expect(body).toEqual({ commentTargets: {}, firstCommentRole: null, retroactiveNotifyRoles: ["COORDINADOR_NACIONAL"] });
  });

  it("PUT responde 401/403 según sesión y rol, sin llamar a Django", async () => {
    mockSession(null);
    expect((await notificationRulesPUT(jsonRequest({}))).status).toBe(401);
    mockSession({ role: "COORDINADOR_NACIONAL" });
    expect((await notificationRulesPUT(jsonRequest({}))).status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("PUT responde 400 si el body no es JSON válido", async () => {
    mockSession({});
    const res = await notificationRulesPUT(badJsonRequest());
    expect(res.status).toBe(400);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("PUT propaga el mensaje de error plano de Django (ej. configuración inválida)", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Configuración inválida" }, 400));
    const res = await notificationRulesPUT(
      jsonRequest({ commentTargets: null, firstCommentRole: null, retroactiveNotifyRoles: [] })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Configuración inválida");
  });

  it("PUT reenvía la configuración a Django y devuelve la vigente", async () => {
    mockSession({ userId: "admin-1" });
    const config = {
      commentTargets: { ASISTENTE_GH: ["ANALISTA_CC"], ANALISTA_CC: [] },
      firstCommentRole: "COORDINADOR_NACIONAL" as const,
      retroactiveNotifyRoles: ["COORDINADOR_NACIONAL", "JEFE_NACIONAL"],
    };
    djangoApiFetch.mockResolvedValueOnce(djangoResponse(true, {})).mockResolvedValueOnce(
      djangoResponse(true, {
        comment_targets: config.commentTargets,
        first_comment_role: config.firstCommentRole,
        retroactive_notify_roles: config.retroactiveNotifyRoles,
      })
    );
    const res = await notificationRulesPUT(jsonRequest(config));
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/notification-rules/", {
      method: "PUT",
      body: JSON.stringify({
        comment_targets: config.commentTargets,
        first_comment_role: config.firstCommentRole,
        retroactive_notify_roles: config.retroactiveNotifyRoles,
      }),
    });
    const body = await res.json();
    expect(body).toEqual(config);
  });
});
