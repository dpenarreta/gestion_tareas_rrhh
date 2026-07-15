import "server-only";

// Patrones de tokens de proveedores externos usados en integraciones (GitHub,
// Groq) que nunca deben llegar a los logs del servidor, ni siquiera parciales.
const TOKEN_PATTERNS = [/ghp_[A-Za-z0-9]+/g, /github_pat_[A-Za-z0-9_]+/g, /gsk_[A-Za-z0-9]+/g, /sk-[A-Za-z0-9-]+/g];

function redactTokens(value: string): string {
  let redacted = value;
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") return redactTokens(value);
  if (value instanceof Error) return redactTokens(`${value.name}: ${value.message}`);
  if (value === null || typeof value !== "object") return value;
  try {
    return redactTokens(JSON.stringify(value));
  } catch {
    return "[unserializable]";
  }
}

/** console.log/warn/error envuelto para que ningún token de integraciones externas llegue a los logs, ni siquiera parcialmente. */
export function safeLog(level: "log" | "warn" | "error", message: string, meta?: unknown): void {
  const safeMessage = redactTokens(message);
  if (meta === undefined) {
    console[level](safeMessage);
  } else {
    console[level](safeMessage, sanitize(meta));
  }
}
