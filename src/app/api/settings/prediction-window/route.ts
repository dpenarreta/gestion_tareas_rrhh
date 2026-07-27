import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { setConfigValue, CONFIG_KEY_PREDICTION_WINDOW_WEEKS } from "@/lib/systemConfig";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import { PREDICTION_WINDOW_OPTIONS, isValidPredictionWindow, getEffectivePredictionWindowWeeks } from "@/lib/predictiveConfig";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const windowWeeks = await getEffectivePredictionWindowWeeks();
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

  await setConfigValue(CONFIG_KEY_PREDICTION_WINDOW_WEEKS, windowWeeks, session.userId);
  invalidateAnalyticsCache();

  return NextResponse.json({ windowWeeks: await getEffectivePredictionWindowWeeks(), options: PREDICTION_WINDOW_OPTIONS });
}
