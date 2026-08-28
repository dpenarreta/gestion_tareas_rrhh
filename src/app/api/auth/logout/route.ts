import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/session";
import { clearDjangoTokenCookies, djangoApiFetch } from "@/lib/djangoSession";

// Fase 6b de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-17):
// revoca la sesión Django (best-effort — si no hay sesión Django o la
// llamada falla, el logout de Next.js debe completarse igual) y limpia
// las cookies `nexo-django-access`/`nexo-django-refresh`, que hasta ahora
// quedaban vivas hasta expirar por su cuenta.
export async function POST() {
  try {
    await djangoApiFetch("/auth/logout/", { method: "POST" });
  } catch {
    // best-effort — nunca debe impedir que el usuario cierre sesión.
  }
  await clearDjangoTokenCookies();
  await deleteSession();
  return NextResponse.json({ ok: true });
}
