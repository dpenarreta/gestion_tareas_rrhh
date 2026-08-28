import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoResetConsentAll = { ok: boolean; count: number };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25): réplica de la
// acción `reset_consent_all` de `UserAdminViewSet` (backend, Fase 13,
// completo) — Django ya exige `IsAdministrator` (mismo chequeo
// estricto que este `route.ts` conserva en TS, acción masiva
// irreversible).
export async function PATCH() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json(
      { error: "Solo un Administrador puede restablecer el consentimiento de todos los usuarios" },
      { status: 403 }
    );
  }

  const response = await djangoApiFetch("/admin/users/reset-consent-all/", { method: "POST" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo restablecer el consentimiento" }, { status: 400 });
  }

  const data = (await response.json()) as DjangoResetConsentAll;
  return NextResponse.json({ ok: true, count: data.count });
}
