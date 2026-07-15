import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import { getVisibleRoles } from "@/lib/roles";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

const findMany = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany, findUnique, create },
  },
}));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/users/route");

function mockSession(overrides: Partial<SessionPayload> | null) {
  vi.mocked(getSession).mockResolvedValue(
    overrides === null
      ? null
      : {
          userId: "u1",
          role: "ASISTENTE_GH",
          name: "Test",
          email: "test@nexo.com",
          expiresAt: new Date(Date.now() + 100000).toISOString(),
          ...overrides,
        }
  );
}

function postRequest(body: unknown) {
  return {
    json: async () => body,
  } as never;
}

describe("GET /api/users", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    findMany.mockReset();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de gestión de usuarios (ASISTENTE_GH)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("responde 403 para un rol de nivel intermedio sin permiso (COORDINADOR_ZS)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("ADMINISTRADOR consulta sin filtro de rol (where={}) y ve a todos", async () => {
    mockSession({ role: "ADMINISTRADOR" });
    findMany.mockResolvedValue([]);
    await GET();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("un rol gestor no-Administrador consulta filtrado por sus roles visibles (lo que excluye siempre a ADMINISTRADOR)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findMany.mockResolvedValue([]);
    await GET();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: { in: getVisibleRoles("JEFE_NACIONAL") } } })
    );
  });

  it("enmascara el email de cada usuario en la respuesta", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findMany.mockResolvedValue([
      { id: "1", name: "Ana", email: "ana@example.com", role: "ASISTENTE_GH", createdAt: new Date() },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body[0].email).toBe("a**@e*****.com");
    expect(body[0].email).not.toBe("ana@example.com");
  });
});

describe("POST /api/users", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    findUnique.mockReset();
    create.mockReset();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de gestión de usuarios", async () => {
    mockSession({ role: "ANALISTA_CC" });
    const res = await POST(postRequest({}));
    expect(res.status).toBe(403);
  });

  it("responde 400 si falta algún campo requerido", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await POST(postRequest({ name: "Ana", email: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/requeridos/);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("responde 403 si se intenta asignar un rol superior al del solicitante", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" }); // nivel 3
    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "JEFE_NACIONAL" })); // nivel 4
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/rol superior/);
    expect(create).not.toHaveBeenCalled();
  });

  it("permite asignar un rol del mismo nivel jerárquico que el del solicitante", async () => {
    mockSession({ role: "COORDINADOR_NACIONAL" });
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "new", name: "Ana", email: "ana@nexo.com", role: "COORDINADOR_NACIONAL", createdAt: new Date() });
    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "COORDINADOR_NACIONAL" }));
    expect(res.status).toBe(201);
  });

  it("responde 409 si el email ya está registrado", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue({ id: "existing" });
    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH" }));
    expect(res.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("crea el usuario con contraseña por defecto hasheada y devuelve 201 sin exponer el hash", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    findUnique.mockResolvedValue(null);
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-id",
      name: data.name,
      email: data.email,
      role: data.role,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }));

    const res = await POST(postRequest({ name: "Ana", email: "ana@nexo.com", role: "ASISTENTE_GH" }));
    expect(res.status).toBe(201);

    const createCall = create.mock.calls[0][0];
    expect(createCall.data.name).toBe("Ana");
    expect(createCall.data.email).toBe("ana@nexo.com");
    expect(createCall.data.role).toBe("ASISTENTE_GH");
    // La contraseña por defecto (123456) debe llegar hasheada, nunca en texto plano.
    expect(createCall.data.password).not.toBe("123456");
    expect(typeof createCall.data.password).toBe("string");
    expect(createCall.data.password.length).toBeGreaterThan(20);

    const body = await res.json();
    expect(body).not.toHaveProperty("password");
  });
});
