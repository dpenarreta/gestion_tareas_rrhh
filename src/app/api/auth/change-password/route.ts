import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchDjangoPasswordMinLength } from "@/lib/djangoPasswordPolicyConfig";
import { djangoApiFetch, extractDjangoFieldErrorMessage } from "@/lib/djangoSession";

// Fase 6b de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-17):
// esta ruta pasó de Prisma/bcrypt a Django (`POST /auth/password/change/`,
// ya autenticado con la sesión Django establecida en el login). `new_password_
// confirm` reusa `newPassword` — el frontend (`profile/page.tsx`) ya valida
// `newPassword === confirmPassword` client-side pero nunca mandaba ese
// segundo campo al backend. Comportamiento nuevo aceptado: Django además
// revoca las demás sesiones activas del usuario y envía un email real de
// notificación — mejora de seguridad, no una regresión.
//
// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 61): la
// longitud mínima pasó de Postgres (`getEffectivePasswordMinLength`) a
// Django (`GET /settings/seguridad-config/`, vía
// `fetchDjangoPasswordMinLength`) — misma fuente que edita la UI de
// Ajustes. Esta pre-validación es solo UX (mensaje de error específico
// antes de llamar a Django) — el validador autoritativo real es Django
// (`AUTH_PASSWORD_VALIDATORS`, `MinimumLengthValidator(min_length=10)`,
// hardcodeado, sin conexión con este valor configurable — hallazgo
// documentado en `docs/AUDIT_LOG.md`, no corregido en esta fase).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { currentPassword, newPassword } = await request.json();

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Campos requeridos" }, { status: 400 });
  }

  const minLength = await fetchDjangoPasswordMinLength();
  if (newPassword.length < minLength) {
    return NextResponse.json({ error: `La contraseña debe tener al menos ${minLength} caracteres` }, { status: 400 });
  }

  const response = await djangoApiFetch("/auth/password/change/", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      new_password_confirm: newPassword,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFieldErrorMessage(response);
    return NextResponse.json({ error: message ?? "Contraseña actual incorrecta" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
