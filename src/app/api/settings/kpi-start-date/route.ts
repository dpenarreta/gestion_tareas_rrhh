import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoKpiStartDateUser = { id: number; name: string; email: string; role: string; kpi_start_date: string | null };

function toNexoShape(u: DjangoKpiStartDateUser) {
  return { id: String(u.id), name: u.name, email: u.email, role: u.role, kpiStartDate: u.kpi_start_date };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `KpiStartDateView` (backend, Fase 31, completo) — ya consumida por el
// bundle de Analytics/Workload desde la Fase 4a; esta config seguía
// editándose en Postgres, sin ningún efecto real desde entonces (gap
// preexistente, cerrado acá).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/kpi-start-date/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener la fecha de inicio de KPIs" }, { status: response.status });
  }

  const data = (await response.json()) as DjangoKpiStartDateUser[];
  return NextResponse.json(data.map(toNexoShape));
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { userId, kpiStartDate } = body as { userId?: string; kpiStartDate?: string | null };
  if (!userId) {
    return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/kpi-start-date/", {
    method: "PATCH",
    body: JSON.stringify({ user_id: userId, kpi_start_date: kpiStartDate ?? null }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Fecha inválida" }, { status: 400 });
  }

  const data = (await response.json()) as DjangoKpiStartDateUser;
  return NextResponse.json(toNexoShape(data));
}
