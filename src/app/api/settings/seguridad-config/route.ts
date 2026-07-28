import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getEffectivePasswordMinLength,
  setPasswordMinLength,
  getEffectiveSessionDurationDefaultHours,
  setSessionDurationDefaultHours,
  getEffectiveSessionDurationRememberHours,
  setSessionDurationRememberHours,
  getEffectiveRetentionLoginAttempts,
  setRetentionLoginAttempts,
} from "@/lib/systemConfig";

const RETENTION_LOGIN_ATTEMPTS_OPTIONS = ["7", "15", "30", "60", "90"];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [passwordMinLength, sessionDurationDefaultHours, sessionDurationRememberHours, retentionLoginAttemptsDays] =
    await Promise.all([
      getEffectivePasswordMinLength(),
      getEffectiveSessionDurationDefaultHours(),
      getEffectiveSessionDurationRememberHours(),
      getEffectiveRetentionLoginAttempts(),
    ]);
  return NextResponse.json({
    passwordMinLength,
    sessionDurationDefaultHours,
    sessionDurationRememberHours,
    retentionLoginAttemptsDays,
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
    if (!Number.isInteger(passwordMinLength) || passwordMinLength < 4 || passwordMinLength > 128) {
      return NextResponse.json({ error: "La longitud mínima de contraseña debe ser un entero entre 4 y 128" }, { status: 400 });
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

  await Promise.all([
    passwordMinLength !== undefined ? setPasswordMinLength(passwordMinLength, session.userId) : Promise.resolve(),
    sessionDurationDefaultHours !== undefined
      ? setSessionDurationDefaultHours(sessionDurationDefaultHours, session.userId)
      : Promise.resolve(),
    sessionDurationRememberHours !== undefined
      ? setSessionDurationRememberHours(sessionDurationRememberHours, session.userId)
      : Promise.resolve(),
    retentionLoginAttemptsDays !== undefined
      ? setRetentionLoginAttempts(retentionLoginAttemptsDays, session.userId)
      : Promise.resolve(),
  ]);

  const [effectivePwd, effectiveDefault, effectiveRemember, effectiveRetention] = await Promise.all([
    getEffectivePasswordMinLength(),
    getEffectiveSessionDurationDefaultHours(),
    getEffectiveSessionDurationRememberHours(),
    getEffectiveRetentionLoginAttempts(),
  ]);
  return NextResponse.json({
    passwordMinLength: effectivePwd,
    sessionDurationDefaultHours: effectiveDefault,
    sessionDurationRememberHours: effectiveRemember,
    retentionLoginAttemptsDays: effectiveRetention,
  });
}
