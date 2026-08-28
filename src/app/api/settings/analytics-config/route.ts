import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import { extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import {
  ANALYTICS_CONFIG_DEFAULTS,
  PREDICTION_MAX_DAYS,
  fetchDjangoAnalyticsConfig,
  patchDjangoAnalyticsConfig,
  type AnalyticsConfigKey,
} from "@/lib/djangoSystemConfigAdapter";
import { invalidateAnalyticsCache } from "@/lib/analytics";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack — Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27): réplica de
// `AnalyticsConfigView` (backend, completa desde la Fase 31 — mismas 3 sumas
// de ponderación + orden de 3 umbrales validados del lado Django, ya no acá).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const config = await fetchDjangoAnalyticsConfig();
  return NextResponse.json({ config, defaults: ANALYTICS_CONFIG_DEFAULTS, predictionMaxDays: PREDICTION_MAX_DAYS });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  let body: Partial<Record<AnalyticsConfigKey, number>>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (Object.keys(body).length === 0) return NextResponse.json({ error: "Nada que guardar" }, { status: 400 });

  const response = await patchDjangoAnalyticsConfig(body);
  if (!response) return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  invalidateAnalyticsCache();
  const updated = await fetchDjangoAnalyticsConfig();
  return NextResponse.json({ config: updated });
}
