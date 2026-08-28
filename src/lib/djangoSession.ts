import "server-only";
import { cookies } from "next/headers";
import { safeLog } from "@/lib/logger";
import type { SessionPayload } from "@/lib/session";

/**
 * Puente de sesión hacia el backend Django. Desde la Fase 6a (ver
 * docs/AUDIT_LOG.md § 2026-08-14), el login real de Next.js
 * (`src/app/api/auth/login/route.ts`) autentica contra Django
 * (`loginToDjango`) — ya NO es un puente best-effort en paralelo al
 * login real, es la única fuente de verdad para validar credenciales.
 */

const DJANGO_API_URL = process.env.DJANGO_API_URL || "http://localhost:8000/api/v1";
const ACCESS_COOKIE = "nexo-django-access";
const REFRESH_COOKIE = "nexo-django-refresh";
const REQUEST_TIMEOUT_MS = 3000;

// Deben coincidir con JWT_ACCESS_TOKEN_LIFETIME_MINUTES/JWT_REFRESH_TOKEN_LIFETIME_DAYS
// de backend/.env — la cookie no debe sobrevivir más que el token que contiene.
const ACCESS_COOKIE_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export type DjangoTokens = {
  access: string;
  refresh: string;
  session_policy: { default_hours: number; remember_hours: number };
};

export type DjangoLoginResult =
  | { ok: true; tokens: DjangoTokens }
  | { ok: false; status: number; message: string };

/**
 * Autentica `identifier`/`password` contra Django — fuente de verdad del
 * login real desde la Fase 6a. A diferencia de `djangoApiFetch`, acá un
 * fallo SÍ es visible para el llamador (no hay fallback silencioso
 * posible: es la única forma de validar credenciales que le queda a
 * Next.js). No lanza — cualquier error (credenciales inválidas, Django
 * caído, timeout) se devuelve como `{ ok: false }` con un mensaje ya
 * listo para mostrar.
 */
export async function loginToDjango(identifier: string, password: string): Promise<DjangoLoginResult> {
  let response: Response;
  try {
    response = await fetch(`${DJANGO_API_URL}/auth/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    safeLog("warn", "No se pudo conectar con el servicio de autenticación", err);
    return { ok: false, status: 503, message: "No se pudo conectar con el servicio de autenticación." };
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data?.error?.message === "string" ? data.error.message : "No fue posible iniciar sesión con esas credenciales.";
    return { ok: false, status: response.status, message };
  }
  return { ok: true, tokens: data as DjangoTokens };
}

const PASSWORD_RESET_GENERIC_MESSAGE =
  "Si el dato ingresado corresponde a una cuenta, se enviará un enlace de recuperación al correo asociado.";

/**
 * Fase 6c (ver docs/AUDIT_LOG.md § 2026-08-17): solicita el envío del
 * email de recuperación — endpoint público, sin sesión. Django responde
 * siempre el mismo mensaje genérico (200), exista o no la cuenta — si la
 * llamada ni siquiera llega a completarse (Django caído/timeout), se
 * devuelve el mismo mensaje genérico igual, para no filtrar por esa vía
 * si el servicio está caído.
 */
export async function requestDjangoPasswordReset(identifier: string): Promise<{ message: string }> {
  try {
    const response = await fetch(`${DJANGO_API_URL}/auth/password-reset/request/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => null);
    const message = typeof data?.detail === "string" ? data.detail : PASSWORD_RESET_GENERIC_MESSAGE;
    return { message };
  } catch (err) {
    safeLog("warn", "No se pudo conectar con el servicio de recuperación de contraseña", err);
    return { message: PASSWORD_RESET_GENERIC_MESSAGE };
  }
}

export type DjangoConfirmResetResult = { ok: true } | { ok: false; message: string };

/**
 * Fase 6c: confirma el reset con el token recibido por email — endpoint
 * público, sin sesión. `new_password_confirm` reusa `newPassword` (la
 * pantalla nueva ya valida la coincidencia client-side).
 */
export async function confirmDjangoPasswordReset(token: string, newPassword: string): Promise<DjangoConfirmResetResult> {
  let response: Response;
  try {
    response = await fetch(`${DJANGO_API_URL}/auth/password-reset/confirm/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password: newPassword, new_password_confirm: newPassword }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    safeLog("warn", "No se pudo conectar con el servicio de recuperación de contraseña", err);
    return { ok: false, message: "No se pudo conectar con el servicio de recuperación de contraseña." };
  }

  if (!response.ok) {
    const message = await extractDjangoFieldErrorMessage(response);
    return { ok: false, message: message ?? "El enlace de recuperación no es válido o expiró." };
  }
  return { ok: true };
}

/** Guarda el par de tokens de Django en cookies httpOnly. */
export async function setDjangoTokenCookies(tokens: Pick<DjangoTokens, "access" | "refresh">): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_COOKIE, tokens.access, cookieOptions(ACCESS_COOKIE_MAX_AGE_SECONDS));
  cookieStore.set(REFRESH_COOKIE, tokens.refresh, cookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS));
}

/** Borra las cookies de Django — Fase 6b (ver docs/AUDIT_LOG.md §
 * 2026-08-17): hasta ahora nada las limpiaba en el logout. */
export async function clearDjangoTokenCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
}

async function refreshDjangoAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${DJANGO_API_URL}/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { access: string };
    cookieStore.set(ACCESS_COOKIE, data.access, cookieOptions(ACCESS_COOKIE_MAX_AGE_SECONDS));
    return data.access;
  } catch (err) {
    safeLog("warn", "No se pudo refrescar la sesión Django", err);
    return null;
  }
}

// Fase 3e (ver docs/AUDIT_LOG.md § 2026-08-07): `Content-Type` solo se
// fuerza a JSON cuando el body no es `FormData` — un `FormData` necesita
// que `fetch` genere su propio boundary de multipart, nunca un
// Content-Type manual. Todos los llamadores existentes (que nunca pasan
// `FormData`) siguen recibiendo exactamente `application/json`, sin
// cambio de comportamiento.
async function callDjango(path: string, init: RequestInit, accessToken: string): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  headers.Authorization = `Bearer ${accessToken}`;
  if (!(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${DJANGO_API_URL}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Extrae el primer mensaje de error de campo del contrato uniforme de
 * Django (`{"error":{"code","message","details"}}` — ver
 * `backend/apps/core/exceptions.py`). Fase 6b (ver docs/AUDIT_LOG.md §
 * 2026-08-17): 2do consumidor real (`me`/`change-password`), se centraliza
 * acá en vez de duplicarlo — mismo criterio que
 * `extractDjangoProjectErrorMessage` de `djangoProjectsAdapter.ts` (que no
 * se reusa porque vive en un módulo aparte, específico de Proyectos).
 */
export async function extractDjangoFieldErrorMessage(response: Response): Promise<string | undefined> {
  const data = await response.json().catch(() => null);
  const details = data?.error?.details;
  if (details && typeof details === "object") {
    const fieldError = Object.values(details as Record<string, unknown>).find(
      (v): v is string[] => Array.isArray(v) && typeof v[0] === "string"
    );
    if (fieldError) return fieldError[0];
  }
  return undefined;
}

/**
 * Extrae el mensaje de `{"error": "mensaje"}` — contrato plano usado por
 * `apps.configuration` (Fase 28+): a diferencia del contrato anidado de
 * `apps.core.exceptions` (`extractDjangoFieldErrorMessage`), estas vistas
 * construyen la `Response` de error a mano, sin pasar por el manejador
 * global de excepciones.
 */
export async function extractDjangoFlatErrorMessage(response: Response): Promise<string | undefined> {
  const data = await response.json().catch(() => null);
  return typeof data?.error === "string" ? data.error : undefined;
}

/**
 * Llama a un endpoint de Django autenticado con la sesión establecida por
 * `loginToDjango`/`setDjangoTokenCookies` durante el login. Devuelve `null`
 * cuando no hay sesión Django disponible (sin cookie, o refresh fallido) —
 * el llamador debe tratar eso como "esta sesión de Next.js todavía no tiene
 * acceso a este módulo", no como un error genérico de Django.
 */
export async function djangoApiFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!accessToken) return null;

  let response = await callDjango(path, init, accessToken);
  if (response.status === 401) {
    const refreshed = await refreshDjangoAccessToken();
    if (!refreshed) return null;
    response = await callDjango(path, init, refreshed);
  }
  return response;
}

/**
 * Resuelve el id NUMÉRICO de Django del usuario en sesión — Fase 40 de la
 * migración de stack (ver docs/AUDIT_LOG.md § 2026-08-21): `session.userId`
 * (Next.js) sigue siendo el `cuid` de Postgres (Fase 6a); los módulos que
 * llaman a Django directamente (para construir `/users/<id>/...` o mandar
 * un `authorId`/`hostId` numérico) necesitan este otro id. Desde la Fase 40,
 * el login (`auth/login/route.ts`) y la renovación de perfil
 * (`auth/me/route.ts`) ya lo guardan en `session.djangoUserId` — este
 * helper lo usa si está presente, y si no (sesión emitida ANTES de la Fase
 * 40, todavía sin expirar) cae una única vez a `GET /auth/me/` para
 * resolverlo. Devuelve `null` si no hay sesión Django disponible.
 */
export async function resolveDjangoUserId(session: SessionPayload): Promise<number | null> {
  if (typeof session.djangoUserId === "number") return session.djangoUserId;

  const response = await djangoApiFetch("/auth/me/");
  if (!response || !response.ok) return null;
  const me: { id: number } = await response.json();
  return me.id;
}
