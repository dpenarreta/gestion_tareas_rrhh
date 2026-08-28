import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { fetchDjangoPredictionWindowWeeks, putDjangoPredictionWindowWeeks } from "@/lib/djangoSystemConfigAdapter";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { PREDICTION_WINDOW_OPTIONS, isValidPredictionWindow } from "@/lib/predictiveConfig";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack — Fase 84 (ver docs/AUDIT_LOG.md § 2026-08-27): réplica de
// `PredictionWindowSettingsView` (backend, completa desde la Fase 13). Django
// no invalida ninguna caché de Analytics (esa capa con TTL nunca se portó,
// mismo gap ya aceptado desde la Fase 9a) — `invalidateAnalyticsCache()`
// sigue corriendo del lado Next.js tras el PUT, igual que antes.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const windowWeeks = await fetchDjangoPredictionWindowWeeks();
  return NextResponse.json({ windowWeeks, options: PREDICTION_WINDOW_OPTIONS });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { windowWeeks?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { windowWeeks } = body;
  if (!windowWeeks || !isValidPredictionWindow(windowWeeks)) {
    return NextResponse.json({ error: "Ventana histórica inválida" }, { status: 400 });
  }

  const response = await putDjangoPredictionWindowWeeks(windowWeeks);
  if (!response) return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Ventana histórica inválida" }, { status: response.status === 403 ? 403 : 400 });
  }

  invalidateAnalyticsCache();
  return NextResponse.json({ windowWeeks: await fetchDjangoPredictionWindowWeeks(), options: PREDICTION_WINDOW_OPTIONS });
}
