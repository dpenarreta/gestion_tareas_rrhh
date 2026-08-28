import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoConsent = { data_consent_accepted: boolean; data_consent_accepted_at: string | null };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25): réplica de
// `AcceptConsentView` (backend, Fase 13, completo).
export async function PATCH() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const response = await djangoApiFetch("/auth/consent/", { method: "PATCH" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo registrar el consentimiento" }, { status: 400 });
  }

  const data = (await response.json()) as DjangoConsent;
  return NextResponse.json({
    dataConsentAccepted: data.data_consent_accepted,
    dataConsentAcceptedAt: data.data_consent_accepted_at,
  });
}
