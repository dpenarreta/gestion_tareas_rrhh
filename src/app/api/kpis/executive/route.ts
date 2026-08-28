import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoKpiPayloadToNexoShape } from "@/lib/djangoKpisAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `ExecutiveDashboardView` (backend, Fase 21) — gateado por
// `is_leadership` (ROLE_LEVEL>=3), distinto del filtro `isExecutorRole`
// (ROLE_LEVEL>=4) aplicado a los SUJETOS del dashboard.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/kpis/executive/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener el dashboard ejecutivo" }, { status: response.status });
  }

  const payload = mapDjangoKpiPayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
