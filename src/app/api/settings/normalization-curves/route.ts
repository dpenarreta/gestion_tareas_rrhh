import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import { getAllEffectiveCurves, setCurveConfig } from "@/lib/systemConfig";
import { DEFAULT_CURVES, isValidCurve, type CurveName } from "@/lib/normalizationEngine";
import { invalidateAnalyticsCache } from "@/lib/analytics";

const CURVE_NAMES: CurveName[] = ["cumplimiento", "vencidas", "carga", "capacidad", "consistencia", "trazabilidad"];

/** Curvas de normalización configurables desde Ajustes (§Sprint 5 S5-D/S5-E) — mismo grupo de acceso que /api/settings/analytics-config. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const curves = await getAllEffectiveCurves();
  return NextResponse.json({ curves, defaults: DEFAULT_CURVES });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { name, points } = (body ?? {}) as { name?: string; points?: unknown };
  if (!name || !CURVE_NAMES.includes(name as CurveName)) {
    return NextResponse.json({ error: `Curva desconocida: ${name}` }, { status: 400 });
  }
  if (!isValidCurve(points)) {
    return NextResponse.json({ error: "Curva inválida: se requieren al menos 2 puntos con x/y finitos e y en [0,100]" }, { status: 400 });
  }

  await setCurveConfig(name as CurveName, points, session.userId);
  invalidateAnalyticsCache();

  const curves = await getAllEffectiveCurves();
  return NextResponse.json({ curves });
}
