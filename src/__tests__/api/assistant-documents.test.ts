import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type { NextRequest } from "next/server";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 58): estas
// rutas pasaron de Prisma a Django (`apps.assistant`) — mockeado con
// `@/lib/djangoSession`, mismo patrón que `team.test.ts`. El procesamiento
// del PDF (`uploadPdfToGithub`/`processGithubDocument`) sigue mockeado
// aparte, sin cambios de comportamiento.
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

const djangoApiFetch = vi.fn();
vi.mock("@/lib/djangoSession", () => ({
  djangoApiFetch: (...args: unknown[]) => djangoApiFetch(...args),
}));

const uploadPdfToGithub = vi.fn();
const processGithubDocument = vi.fn();

vi.mock("@/lib/githubDocuments", () => ({
  uploadPdfToGithub: (...args: unknown[]) => uploadPdfToGithub(...args),
  processGithubDocument: (...args: unknown[]) => processGithubDocument(...args),
  deleteFromGithub: vi.fn(),
}));

const { getSession } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/assistant/documents/route");

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

function djangoResponse(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data } as Response;
}

const BASE_DOC = {
  id: 1,
  title: "Manual",
  file_name: "manual.pdf",
  github_path: null,
  github_sha: null,
  created_at: "2026-08-25T00:00:00Z",
  status: "PROCESANDO",
  processing_error: null,
  uploaded_by_name: "Ana",
  chunk_count: 0,
};

// La ruta real solo usa request.headers.get("content-length") y request.formData()
// — se construye un doble mínimo en vez de un NextRequest/FormData reales para
// controlar con precisión el content-length declarado y forzar errores de parseo,
// sin depender de la codificación multipart real.
function fakeRequest(opts: { contentLength?: string; formData?: () => Promise<FormData> }): NextRequest {
  return {
    headers: new Headers(opts.contentLength !== undefined ? { "content-length": opts.contentLength } : {}),
    formData: opts.formData ?? (async () => new FormData()),
  } as unknown as NextRequest;
}

function formDataWith(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function makePdfFile(name = "manual.pdf", sizeBytes = 100, type = "application/pdf"): File {
  const content = sizeBytes > 0 ? new Uint8Array(sizeBytes) : new Uint8Array(0);
  return new File([content], name, { type });
}

describe("GET /api/assistant/documents", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    djangoApiFetch.mockReset();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin acceso a la base de conocimiento (ASISTENTE_GH)", async () => {
    mockSession({ role: "ASISTENTE_GH" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("responde 403 para COORDINADOR_ZS (no está en CAN_VIEW_KNOWLEDGE_BASE)", async () => {
    mockSession({ role: "COORDINADOR_ZS" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("responde 401 si Django no tiene sesión disponible", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("un rol autorizado recibe la lista de documentos mapeada a la forma Nexo", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    djangoApiFetch.mockResolvedValue(djangoResponse(true, [BASE_DOC]));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(djangoApiFetch).toHaveBeenCalledWith("/assistant/documents/");
    const body = await res.json();
    expect(body[0]).toMatchObject({
      id: "1",
      title: "Manual",
      fileName: "manual.pdf",
      uploadedBy: { name: "Ana" },
      _count: { chunks: 0 },
    });
  });
});

describe("POST /api/assistant/documents", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    djangoApiFetch.mockReset();
    uploadPdfToGithub.mockReset();
    processGithubDocument.mockReset();
    mockSession({ role: "ADMINISTRADOR" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde 401 si no hay sesión", async () => {
    mockSession(null);
    const res = await POST(fakeRequest({ contentLength: "0" }));
    expect(res.status).toBe(401);
  });

  it("responde 403 para un rol sin permiso de administración de documentos (JEFE_NACIONAL no puede subir, solo ADMINISTRADOR)", async () => {
    mockSession({ role: "JEFE_NACIONAL" });
    const res = await POST(fakeRequest({ contentLength: "0" }));
    expect(res.status).toBe(403);
  });

  it("responde 413 si el header content-length ya supera el límite, sin llegar a parsear el formulario", async () => {
    const formDataSpy = vi.fn();
    const res = await POST(fakeRequest({ contentLength: String(5 * 1024 * 1024), formData: formDataSpy }));
    expect(res.status).toBe(413);
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  it("responde 400 si el formulario no se puede parsear", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      fakeRequest({
        contentLength: "0",
        formData: async () => {
          throw new Error("bad multipart");
        },
      })
    );
    expect(res.status).toBe(400);
  });

  it("responde 400 si falta el archivo", async () => {
    const res = await POST(fakeRequest({ contentLength: "0", formData: async () => formDataWith({ title: "Manual" }) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Archivo requerido/);
  });

  it("responde 400 si falta el título", async () => {
    const res = await POST(
      fakeRequest({ contentLength: "0", formData: async () => formDataWith({ file: makePdfFile() }) })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Nombre del documento requerido/);
  });

  it("responde 400 si el título es solo espacios en blanco", async () => {
    const res = await POST(
      fakeRequest({
        contentLength: "0",
        formData: async () => formDataWith({ file: makePdfFile(), title: "   " }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("responde 413 si el archivo individual supera el límite de tamaño", async () => {
    const bigFile = makePdfFile("grande.pdf", 4.5 * 1024 * 1024 + 1);
    const res = await POST(
      fakeRequest({ contentLength: "0", formData: async () => formDataWith({ file: bigFile, title: "Manual" }) })
    );
    expect(res.status).toBe(413);
  });

  it("responde 400 si la extensión del archivo no es .pdf", async () => {
    const file = makePdfFile("manual.docx", 100, "application/pdf");
    const res = await POST(
      fakeRequest({ contentLength: "0", formData: async () => formDataWith({ file, title: "Manual" }) })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Solo se aceptan archivos PDF/);
  });

  it("responde 400 si el mime type no es application/pdf (aunque la extensión sí lo sea)", async () => {
    const file = makePdfFile("manual.pdf", 100, "image/png");
    const res = await POST(
      fakeRequest({ contentLength: "0", formData: async () => formDataWith({ file, title: "Manual" }) })
    );
    expect(res.status).toBe(400);
  });

  it("acepta un archivo .pdf sin mime type declarado (file.type vacío)", async () => {
    const file = makePdfFile("manual.pdf", 100, "");
    djangoApiFetch.mockResolvedValue(djangoResponse(true, BASE_DOC));
    uploadPdfToGithub.mockResolvedValue({ path: "docs/1.pdf", sha: "sha123" });
    processGithubDocument.mockResolvedValue(undefined);

    const res = await POST(
      fakeRequest({ contentLength: "0", formData: async () => formDataWith({ file, title: "Manual" }) })
    );
    expect(res.status).toBe(201);
  });

  it("camino feliz: crea el documento, sube a GitHub, procesa y devuelve 201 con el documento final", async () => {
    djangoApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/assistant/documents/" && init?.method === "POST") {
        return djangoResponse(true, { ...BASE_DOC, id: 1 }, 201);
      }
      if (url === "/assistant/documents/1/" && init?.method === "PATCH") {
        return djangoResponse(true, { ...BASE_DOC, id: 1, github_path: "docs/1.pdf", github_sha: "sha123" });
      }
      if (url === "/assistant/documents/1/" && !init) {
        return djangoResponse(true, { ...BASE_DOC, id: 1, status: "LISTO", chunk_count: 3 });
      }
      throw new Error(`ruta Django no mockeada: ${url}`);
    });
    uploadPdfToGithub.mockResolvedValue({ path: "docs/1.pdf", sha: "sha123" });
    processGithubDocument.mockResolvedValue(undefined);

    const res = await POST(
      fakeRequest({
        contentLength: "0",
        formData: async () => formDataWith({ file: makePdfFile(), title: "Manual" }),
      })
    );

    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/assistant/documents/",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Manual", file_name: "manual.pdf" }) })
    );
    expect(uploadPdfToGithub).toHaveBeenCalledWith("1", "manual.pdf", expect.any(Buffer));
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/assistant/documents/1/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ github_path: "docs/1.pdf", github_sha: "sha123" }) })
    );
    expect(processGithubDocument).toHaveBeenCalledWith("1", "docs/1.pdf", "sha123");

    const body = await res.json();
    expect(body).toMatchObject({ id: "1", title: "Manual", status: "LISTO", _count: { chunks: 3 } });
  });

  it("si la subida a GitHub falla, marca el documento como ERROR y aun así responde 201 con el estado de error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    djangoApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/assistant/documents/" && init?.method === "POST") {
        return djangoResponse(true, { ...BASE_DOC, id: 1 }, 201);
      }
      if (url === "/assistant/documents/1/" && init?.method === "PATCH") {
        return djangoResponse(true, { ...BASE_DOC, id: 1, status: "ERROR", processing_error: "GitHub no disponible" });
      }
      throw new Error(`ruta Django no mockeada: ${url}`);
    });
    uploadPdfToGithub.mockRejectedValue(new Error("GitHub no disponible"));

    const res = await POST(
      fakeRequest({
        contentLength: "0",
        formData: async () => formDataWith({ file: makePdfFile(), title: "Manual" }),
      })
    );

    expect(res.status).toBe(201);
    expect(djangoApiFetch).toHaveBeenCalledWith(
      "/assistant/documents/1/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "ERROR", processing_error: "GitHub no disponible" }) })
    );
    expect(processGithubDocument).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe("ERROR");
  });

  it("un error inesperado durante el procesamiento se captura y responde 500 con el mensaje", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    djangoApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/assistant/documents/" && init?.method === "POST") {
        return djangoResponse(true, { ...BASE_DOC, id: 1 }, 201);
      }
      if (url === "/assistant/documents/1/" && init?.method === "PATCH") {
        return djangoResponse(true, { ...BASE_DOC, id: 1 });
      }
      throw new Error(`ruta Django no mockeada: ${url}`);
    });
    uploadPdfToGithub.mockResolvedValue({ path: "docs/1.pdf", sha: "sha123" });
    processGithubDocument.mockRejectedValue(new Error("fallo inesperado de embeddings"));

    const res = await POST(
      fakeRequest({
        contentLength: "0",
        formData: async () => formDataWith({ file: makePdfFile(), title: "Manual" }),
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/fallo inesperado de embeddings/);
  });
});
