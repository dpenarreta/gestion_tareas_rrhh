import { NextRequest, NextResponse } from "next/server";
import { requestDjangoPasswordReset } from "@/lib/djangoSession";

// Fase 6c de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-17):
// esta ruta pasó del stub simulado de Prisma a Django, que sí envía un
// email real con un link a `/reset-password?token=...`. Fix de seguridad
// incluido: el stub anterior revelaba si una cuenta existía (mensaje
// distinto según el resultado de `prisma.user.findUnique`) — Django
// responde siempre el mismo mensaje genérico.
export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (!email) {
    return NextResponse.json({ error: "El email es requerido" }, { status: 400 });
  }

  const { message } = await requestDjangoPasswordReset(email);
  return NextResponse.json({ message });
}
