import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import {
  fetchNotificationRules,
  putNotificationRules,
  type NotificationRulesConfig,
} from "@/lib/djangoNotificationRulesAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

/**
 * Cutover de stack — Fase 86 (ver docs/AUDIT_LOG.md § 2026-08-28): réplica
 * de `NotificationRulesView` (backend, completa desde la Fase 35). La
 * validación de forma (roles válidos, los 3 campos obligatorios) ya no se
 * hace acá — Django la aplica (`validate_notification_rules_body`) y este
 * `route.ts` solo propaga su mensaje de error, mismo patrón que
 * `prediction-window/route.ts`.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const rules = await fetchNotificationRules();
  return NextResponse.json(rules);
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: NotificationRulesConfig;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const response = await putNotificationRules(body);
  if (!response) return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Configuración inválida" }, { status: response.status === 403 ? 403 : 400 });
  }

  return NextResponse.json(await fetchNotificationRules());
}
