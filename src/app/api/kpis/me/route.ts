import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoKpiPayloadToNexoShape } from "@/lib/djangoKpisAdapter";

// Fase 4b de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-11):
// cortado a Django. `getSession()` se mantiene solo para el 401 — el
// cálculo real de KPIs (uno mismo, sin chequeo de jerarquía) vive en
// `KpiMeView`.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const month = request.nextUrl.searchParams.get("month");
  const query = month ? `?month=${encodeURIComponent(month)}` : "";

  const response = await djangoApiFetch(`/kpis/me/${query}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener los KPIs" }, { status: response.status });
  }

  const payload = mapDjangoKpiPayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
