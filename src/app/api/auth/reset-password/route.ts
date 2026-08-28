import { NextRequest, NextResponse } from "next/server";
import { confirmDjangoPasswordReset } from "@/lib/djangoSession";

// Fase 6c de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-17):
// ruta nueva — confirma el reset de contraseña iniciado en
// `/api/auth/forgot-password`, con el token recibido por email
// (`/reset-password?token=...`). Sin sesión: el usuario todavía no
// inició sesión, está usando un link de recuperación.
export async function POST(request: NextRequest) {
  const { token, newPassword } = await request.json();

  if (!token || !newPassword) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const result = await confirmDjangoPasswordReset(token, newPassword);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
