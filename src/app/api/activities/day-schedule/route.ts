import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

/**
 * Actividades del usuario en sesión, con hora inicio/fin registrada, en
 * cualquier tarea SEGUIMIENTO (no FIJA), para un día dado — usado por el
 * cliente para validar solapamientos de horario antes de guardar. Sin
 * `date`, usa el día calendario de negocio actual.
 *
 * Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): las Actividades que
 * este endpoint valida ya se escriben exclusivamente en Django desde el
 * cutover de Tareas — la versión anterior leía Postgres, sin ver las
 * actividades registradas después de ese cutover (validación de solapamiento
 * incompleta). `DayScheduleView` (Fase 26) es réplica exacta, ya en
 * camelCase — no requiere mapeo de campos.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const dateParam = request.nextUrl.searchParams.get("date");
  const query = dateParam ? `?date=${encodeURIComponent(dateParam)}` : "";

  const response = await djangoApiFetch(`/activities/day-schedule/${query}`);
  if (!response) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    return NextResponse.json({ error: data?.error ?? "Fecha inválida" }, { status: 400 });
  }

  return NextResponse.json(await response.json());
}
