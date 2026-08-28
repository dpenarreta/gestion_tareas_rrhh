import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

const RETENTION_LOGIN_ATTEMPTS_OPTIONS = ["7", "15", "30", "60", "90"];

type DjangoSeguridadConfig = {
  password_min_length: number;
  session_duration_default_hours: number;
  session_duration_remember_hours: number;
  retention_login_attempts_days: string;
};

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 61):
// `passwordMinLength` era el único campo de `seguridad-config` que seguía
// en Postgres (`sessionDurationDefaultHours`/`sessionDurationRememberHours`/
// `retentionLoginAttemptsDays` ya se habían cortado en la Fase 36) —
// `SeguridadConfigView` (Django) ya devolvía `password_min_length` en la
// misma respuesta desde la Fase 32, no hacía falta ninguna llamada extra.
// Django NO enforcea este valor en su propio flujo de cambio de
// contraseña (usa `AUTH_PASSWORD_VALIDATORS.MinimumLengthValidator`,
// hardcodeado en 10, sin conexión con este valor configurable). Fase 75
// (ver docs/AUDIT_LOG.md § 2026-08-26): en vez de hacer que Django
// respete este valor dinámicamente, se clampeó el rango configurable
// (acá abajo y en Django) a un piso de 10 — el mismo que Django ya
// impone siempre — para que Ajustes deje de prometer un mínimo más
// permisivo del que realmente se aplica.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/seguridad-config/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = (await response.json()) as DjangoSeguridadConfig;
  return NextResponse.json({
    passwordMinLength: data.password_min_length,
    sessionDurationDefaultHours: data.session_duration_default_hours,
    sessionDurationRememberHours: data.session_duration_remember_hours,
    retentionLoginAttemptsDays: data.retention_login_attempts_days,
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: {
    passwordMinLength?: number;
    sessionDurationDefaultHours?: number;
    sessionDurationRememberHours?: number;
    retentionLoginAttemptsDays?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { passwordMinLength, sessionDurationDefaultHours, sessionDurationRememberHours, retentionLoginAttemptsDays } = body;

  if (passwordMinLength !== undefined) {
    if (!Number.isInteger(passwordMinLength) || passwordMinLength < 10 || passwordMinLength > 128) {
      return NextResponse.json({ error: "La longitud mínima de contraseña debe ser un entero entre 10 y 128" }, { status: 400 });
    }
  }
  if (sessionDurationDefaultHours !== undefined) {
    if (!Number.isInteger(sessionDurationDefaultHours) || sessionDurationDefaultHours < 1 || sessionDurationDefaultHours > 8760) {
      return NextResponse.json({ error: "La duración de sesión debe ser un entero entre 1 y 8760 horas (1 año)" }, { status: 400 });
    }
  }
  if (sessionDurationRememberHours !== undefined) {
    if (!Number.isInteger(sessionDurationRememberHours) || sessionDurationRememberHours < 1 || sessionDurationRememberHours > 8760) {
      return NextResponse.json({ error: "La duración de sesión (recordarme) debe ser un entero entre 1 y 8760 horas (1 año)" }, { status: 400 });
    }
  }
  if (retentionLoginAttemptsDays !== undefined && !RETENTION_LOGIN_ATTEMPTS_OPTIONS.includes(retentionLoginAttemptsDays)) {
    return NextResponse.json({ error: "Retención de intentos de login inválida" }, { status: 400 });
  }

  const djangoPayload: Record<string, unknown> = {};
  if (passwordMinLength !== undefined) djangoPayload.password_min_length = passwordMinLength;
  if (sessionDurationDefaultHours !== undefined) djangoPayload.session_duration_default_hours = sessionDurationDefaultHours;
  if (sessionDurationRememberHours !== undefined) djangoPayload.session_duration_remember_hours = sessionDurationRememberHours;
  if (retentionLoginAttemptsDays !== undefined) djangoPayload.retention_login_attempts_days = retentionLoginAttemptsDays;

  const response =
    Object.keys(djangoPayload).length > 0
      ? await djangoApiFetch("/settings/seguridad-config/", { method: "PUT", body: JSON.stringify(djangoPayload) })
      : await djangoApiFetch("/settings/seguridad-config/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = (await response.json()) as DjangoSeguridadConfig;
  return NextResponse.json({
    passwordMinLength: data.password_min_length,
    sessionDurationDefaultHours: data.session_duration_default_hours,
    sessionDurationRememberHours: data.session_duration_remember_hours,
    retentionLoginAttemptsDays: data.retention_login_attempts_days,
  });
}
