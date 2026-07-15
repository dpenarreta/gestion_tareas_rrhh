import { describe, expect, it, vi, afterEach } from "vitest";
import { safeLog } from "@/lib/logger";

describe("safeLog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacta un token de GitHub (ghp_) en el mensaje", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    safeLog("log", "token filtrado: ghp_1234567890abcdefABCDEF leaked in logs");
    expect(spy).toHaveBeenCalledTimes(1);
    const [loggedMessage] = spy.mock.calls[0];
    expect(loggedMessage).not.toContain("ghp_1234567890abcdefABCDEF");
    expect(loggedMessage).toContain("[REDACTED]");
  });

  it("redacta un fine-grained GitHub PAT (github_pat_)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    safeLog("error", "fallo con github_pat_11ABCDEFG_somelongtoken123");
    const [loggedMessage] = spy.mock.calls[0];
    expect(loggedMessage).not.toContain("github_pat_11ABCDEFG_somelongtoken123");
    expect(loggedMessage).toContain("[REDACTED]");
  });

  it("redacta un token de Groq (gsk_) y una API key estilo OpenAI/Anthropic (sk-)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    safeLog("warn", "gsk_abcDEF123 y sk-abcDEF123 no deberían aparecer");
    const [loggedMessage] = spy.mock.calls[0];
    expect(loggedMessage).not.toContain("gsk_abcDEF123");
    expect(loggedMessage).not.toContain("sk-abcDEF123");
  });

  it("no modifica mensajes sin tokens", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    safeLog("log", "mensaje normal sin secretos");
    expect(spy).toHaveBeenCalledWith("mensaje normal sin secretos");
  });

  it("no pasa un segundo argumento a console cuando no se provee meta", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    safeLog("log", "solo mensaje");
    expect(spy.mock.calls[0]).toHaveLength(1);
  });

  it("sanitiza un meta string que contiene un token", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    safeLog("log", "info", "token: ghp_secretvalue123");
    const [, meta] = spy.mock.calls[0];
    expect(meta).not.toContain("ghp_secretvalue123");
  });

  it("sanitiza un meta objeto (vía JSON.stringify) que contiene un token", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    safeLog("log", "info", { token: "ghp_objectvalue456", other: "ok" });
    const [, meta] = spy.mock.calls[0];
    expect(String(meta)).not.toContain("ghp_objectvalue456");
    expect(String(meta)).toContain("ok");
  });

  it("sanitiza un meta Error, incluyendo su mensaje", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    safeLog("error", "fallo de integración", new Error("token ghp_errormsg789 inválido"));
    const [, meta] = spy.mock.calls[0];
    expect(String(meta)).not.toContain("ghp_errormsg789");
    expect(String(meta)).toContain("Error");
  });

  it("no falla con meta que no se puede serializar (referencia circular)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => safeLog("log", "info", circular)).not.toThrow();
    const [, meta] = spy.mock.calls[0];
    expect(meta).toBe("[unserializable]");
  });
});
