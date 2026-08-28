import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoTrabajoAvanzado = { retroactive_window_days: number; workday_end_hour: number };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25, Fase 60):
// `retroactiveWindowDays` se cortó en la Fase 36. `workdayEndHour` se
// mantenía en Postgres porque su único consumidor real de entonces
// (`src/lib/capacityForecast.ts`) seguía en Prisma — desde el cutover de
// Inteligencia Preventiva (Fase 48), ese archivo quedó sin ningún
// importador real (código muerto, motor reemplazado por
// `apps/analytics/capacity_forecast.py`), así que la razón que bloqueaba
// este cutover ya no existe. `TrabajoAvanzadoView` (Django) ya devolvía
// `workday_end_hour` en la misma respuesta desde la Fase 32 — no hacía
// falta ninguna llamada extra a Postgres, solo dejar de ignorar el campo.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/trabajo-avanzado/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = (await response.json()) as DjangoTrabajoAvanzado;
  return NextResponse.json({ retroactiveWindowDays: data.retroactive_window_days, workdayEndHour: data.workday_end_hour });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { retroactiveWindowDays?: number; workdayEndHour?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { retroactiveWindowDays, workdayEndHour } = body;

  if (retroactiveWindowDays !== undefined) {
    if (!Number.isInteger(retroactiveWindowDays) || retroactiveWindowDays < 1 || retroactiveWindowDays > 10) {
      return NextResponse.json({ error: "La ventana de registro retroactivo debe ser un entero entre 1 y 10 días" }, { status: 400 });
    }
  }
  if (workdayEndHour !== undefined) {
    if (!Number.isInteger(workdayEndHour) || workdayEndHour < 0 || workdayEndHour > 23) {
      return NextResponse.json({ error: "La hora de corte de jornada debe ser un entero entre 0 y 23" }, { status: 400 });
    }
  }

  const djangoPayload: Record<string, unknown> = {};
  if (retroactiveWindowDays !== undefined) djangoPayload.retroactive_window_days = retroactiveWindowDays;
  if (workdayEndHour !== undefined) djangoPayload.workday_end_hour = workdayEndHour;

  const response =
    Object.keys(djangoPayload).length > 0
      ? await djangoApiFetch("/settings/trabajo-avanzado/", { method: "PUT", body: JSON.stringify(djangoPayload) })
      : await djangoApiFetch("/settings/trabajo-avanzado/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = (await response.json()) as DjangoTrabajoAvanzado;
  return NextResponse.json({ retroactiveWindowDays: data.retroactive_window_days, workdayEndHour: data.workday_end_hour });
}
