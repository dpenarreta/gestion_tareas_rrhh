import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/lib/roles";
import { SESSION_SECRET } from "@/lib/session-secret";
import { requireHttps } from "@/lib/httpsPolicy";

// Mismos defaults que Django (`DEFAULT_SESSION_DURATION_DEFAULT_HOURS`/
// `DEFAULT_SESSION_DURATION_REMEMBER_HOURS`,
// `backend/apps/configuration/services.py`) — Fase 62 de la migración de
// stack (ver docs/AUDIT_LOG.md § 2026-08-25): antes de esta fase, la
// ausencia de `durationHoursOverride` caía a `getEffectiveSessionDurationDefaultHours`/
// `getEffectiveSessionDurationRememberHours` (Postgres, vía
// `src/lib/systemConfig.ts`). Ambos callers reales de `createSession`
// (`auth/login/route.ts`, `auth/me/route.ts`) ya resuelven la duración
// efectiva contra Django y la pasan como `durationHoursOverride` — este
// fallback ya no es una consulta de configuración en el camino crítico
// de sesión, es solo un valor de seguridad para el caso (hoy sin
// caller real) de que alguien invoque `createSession` sin resolverla.
const DEFAULT_SESSION_DURATION_DEFAULT_HOURS = 168; // 7 días
const DEFAULT_SESSION_DURATION_REMEMBER_HOURS = 720; // 30 días

export type SessionPayload = {
  role: Role;
  name: string;
  email: string;
  expiresAt: string;
  // `djangoUserId` es el id NUMÉRICO de Django del usuario en sesión — único
  // identificador de sesión desde el retiro completo del `cuid` legado de
  // Postgres (`legacy_postgres_id`, decisión explícita del usuario, ver
  // docs/AUDIT_LOG.md § 2026-08-31). `resolveDjangoUserId`
  // (`@/lib/djangoSession`) sigue existiendo como red de seguridad genérica
  // (resuelve contra `/auth/me/` si por algún motivo faltara en runtime).
  djangoUserId: number;
  // Codenames del catálogo dinámico de permisos (`GET /auth/me/`, Django ya
  // los calcula vía `get_user_permission_codenames` — ver docs/AUDIT_LOG.md
  // § 2026-09-01, "Catálogo dinámico de permisos extendido a todo el
  // sistema"). Cacheado en el JWT, igual criterio que `role`/`djangoUserId`
  // en este mismo archivo: revocar un permiso no tiene efecto inmediato
  // sobre sesiones activas de ese rol hasta su próximo login o hasta
  // expirar el JWT — mismo trade-off que ya existe hoy para `role`, no una
  // regresión nueva. Django SIEMPRE revalida en tiempo real contra
  // `user.get_all_permissions()` (sin caché) en cada request — este array
  // es exclusivamente para gating de UI, nunca la fuente de verdad real
  // (ver `.claude/rules/security.md`).
  permissions: string[];
};

const COOKIE_NAME = "nexo-session";
const secret = new TextEncoder().encode(SESSION_SECRET);

async function encrypt(payload: Omit<SessionPayload, "expiresAt">, durationMs: number) {
  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  const days = Math.round(durationMs / (24 * 60 * 60 * 1000));
  return new SignJWT({ ...payload, expiresAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secret);
}

export async function decrypt(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(
  data: Omit<SessionPayload, "expiresAt">,
  rememberMe = false,
  durationHoursOverride?: number
) {
  // Configurable desde Sprint O (antes: literales 7d/30d fijos) — solo afecta
  // sesiones NUEVAS, los JWT ya emitidos conservan su `exp` original.
  // `durationHoursOverride` — Fase 6a (ver docs/AUDIT_LOG.md § 2026-08-14):
  // el login cortado a Django ya trae la duración efectiva resuelta en la
  // respuesta (`session_policy`); `auth/me/route.ts` la resuelve por su
  // cuenta desde la Fase 62. Ningún caller real llega hoy sin
  // `durationHoursOverride` — este ternario es solo un piso de seguridad.
  const durationHours =
    durationHoursOverride ??
    (rememberMe ? DEFAULT_SESSION_DURATION_REMEMBER_HOURS : DEFAULT_SESSION_DURATION_DEFAULT_HOURS);
  const durationMs = durationHours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + durationMs);
  const token = await encrypt(data, durationMs);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    // Sin HTTPS el navegador no enviaría una cookie `secure`, así que el
    // despliegue por http interno la necesita en false (ver httpsPolicy.ts).
    secure: process.env.NODE_ENV === "production" && requireHttps,
    expires: expiresAt,
    sameSite: "strict",
    path: "/",
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return decrypt(token);
}

export async function getSessionFromToken(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  return decrypt(token);
}
