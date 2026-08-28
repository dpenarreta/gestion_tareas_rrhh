import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoKpiPayloadToNexoShape } from "@/lib/djangoKpisAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `TeamKpiView` (backend, Fase 19) — `month` reenviado tal cual, sin
// validar formato (mismo comportamiento sin guardas que el original).
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const month = request.nextUrl.searchParams.get("month");
  const query = month ? `?month=${encodeURIComponent(month)}` : "";

  const response = await djangoApiFetch(`/kpis/team/${query}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener los KPIs del equipo" }, { status: response.status });
  }

  const payload = mapDjangoKpiPayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
