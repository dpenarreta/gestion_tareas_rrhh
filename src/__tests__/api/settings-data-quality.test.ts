import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): las 7 entidades
// sobre las que corre este informe (Tareas, Proyectos, Fases, Participantes,
// Motivos de actividad y sus Actividades) ya se escriben exclusivamente en
// Django — `build_data_quality_report` (Fase 34) es réplica exacta de los 7
// chequeos, ya cubiertos por la suite de tests del backend. Acá solo se
// prueba el ruteo (auth/rol) y el mapeo de campos.
const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const { getSession } = await import("@/lib/session");
const { GET: dataQualityGET } = await import("@/app/api/settings/data-quality/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "admin-1",
          role: "ADMINISTRADOR",
          name: "Admin",
          email: "admin@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function resetAll() {
  vi.mocked(getSession).mockReset();
  djangoApiFetch.mockReset();
}

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

describe("GET /api/settings/data-quality", () => {
  beforeEach(resetAll);

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await dataQualityGET();
    expect(res.status).toBe(401);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 403 si el rol no es Administrador", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    const res = await dataQualityGET();
    expect(res.status).toBe(403);
    expect(djangoApiFetch).not.toHaveBeenCalled();
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(null);
    const res = await dataQualityGET();
    expect(res.status).toBe(401);
  });

  it("responde 403 si Django rechaza el rol", async () => {
    mockSession({});
    djangoApiFetch.mockResolvedValue(djangoResponse(false, { error: "Sin permisos" }, 403));
    const res = await dataQualityGET();
    expect(res.status).toBe(403);
  });

  it("mapea generated_at/total_issues a camelCase y pasa los checks tal cual", async () => {
    mockSession({});
    const checks = [
      { key: "fechas_invalidas", label: "Fechas inválidas", count: 1, items: [{ id: "t1", label: "Tarea invertida" }] },
      { key: "registros_huerfanos", label: "Registros huérfanos", count: 0, items: [], note: "Protegido estructuralmente." },
    ];
    djangoApiFetch.mockResolvedValue(
      djangoResponse(true, { generated_at: "2026-08-21T12:00:00Z", total_issues: 1, checks })
    );
    const res = await dataQualityGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ generatedAt: "2026-08-21T12:00:00Z", totalIssues: 1, checks });
    expect(djangoApiFetch).toHaveBeenCalledWith("/settings/data-quality/");
  });
});
