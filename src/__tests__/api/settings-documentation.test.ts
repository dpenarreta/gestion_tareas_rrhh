import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";

const readFile = vi.fn();
const stat = vi.fn();

vi.mock("fs/promises", () => {
  const mod = {
    readFile: (...a: unknown[]) => readFile(...a),
    stat: (...a: unknown[]) => stat(...a),
  };
  return { ...mod, default: mod };
});

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/session");
const { GET: documentationGET } = await import("@/app/api/settings/documentation/route");

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

function req(doc: string) {
  return { nextUrl: { searchParams: new URLSearchParams({ doc }) } } as never;
}

describe("GET /api/settings/documentation", () => {
  beforeEach(() => {
    readFile.mockReset();
    stat.mockReset();
    vi.mocked(getSession).mockReset();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await documentationGET(req("changelog"));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol distinto de Administrador", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await documentationGET(req("changelog"));
    expect(res.status).toBe(403);
  });

  it("responde 400 para una clave de documento no reconocida", async () => {
    mockSession({});
    const res = await documentationGET(req("../../../etc/passwd"));
    expect(res.status).toBe(400);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("lee el archivo Markdown correspondiente y devuelve su contenido + fecha de modificación", async () => {
    mockSession({});
    readFile.mockResolvedValue("# Changelog\n\ncontenido");
    stat.mockResolvedValue({ mtime: new Date("2026-07-22T10:00:00.000Z") });

    const res = await documentationGET(req("changelog"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("# Changelog\n\ncontenido");
    expect(body.updatedAt).toBe("2026-07-22T10:00:00.000Z");
    expect(readFile.mock.calls[0][0]).toMatch(/docs[\\/]CHANGELOG\.md$/);
  });

  it("cada clave del mapa de documentos resuelve a un archivo real dentro de /docs", async () => {
    mockSession({});
    readFile.mockResolvedValue("contenido");
    stat.mockResolvedValue({ mtime: new Date() });

    for (const doc of ["version", "changelog", "decisions", "roadmap", "architecture", "formulas"]) {
      readFile.mockClear();
      const res = await documentationGET(req(doc));
      expect(res.status).toBe(200);
      expect(readFile).toHaveBeenCalledTimes(1);
    }
  });

  it("responde 500 si la lectura del archivo falla", async () => {
    mockSession({});
    readFile.mockRejectedValue(new Error("ENOENT"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await documentationGET(req("roadmap"));
    expect(res.status).toBe(500);
  });
});
