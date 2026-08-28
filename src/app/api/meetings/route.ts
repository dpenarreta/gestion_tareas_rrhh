import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  extractDjangoMeetingErrorMessage,
  mapDjangoMeetingToNexoShape,
  type DjangoMeeting,
} from "@/lib/djangoMeetingsAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django. `inviteeIds` ya llega en id numérico de Django (el
// selector de invitados usa `/api/users/assignable`, cutover en el mismo
// cambio) — Django filtra al propio anfitrión de la lista internamente
// (`create_meeting`), no hace falta replicarlo acá. La integración real de
// Zoom (OAuth Server-to-Server, con fallback simulado si falla) y la
// notificación a los invitados ya viven en `apps.meetings.services.create_meeting`.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const response = await djangoApiFetch("/meetings/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudieron obtener las reuniones" }, { status: 400 });
  }

  const meetings: DjangoMeeting[] = await response.json();
  return NextResponse.json(meetings.map(mapDjangoMeetingToNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Cuerpo de solicitud inválido" }, { status: 400 });
  }

  const { title, description, meetingDate, duration, inviteeIds } = body;

  const response = await djangoApiFetch("/meetings/", {
    method: "POST",
    body: JSON.stringify({
      title,
      description: description ?? null,
      meeting_date: meetingDate,
      duration,
      invitee_ids: Array.isArray(inviteeIds) ? inviteeIds.map(Number) : [],
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos para crear reuniones" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoMeetingErrorMessage(response);
    return NextResponse.json({ error: message ?? "Faltan campos requeridos" }, { status: 400 });
  }

  const created: DjangoMeeting & { zoom_warning: string | null } = await response.json();
  return NextResponse.json(
    { ...mapDjangoMeetingToNexoShape(created), zoomWarning: created.zoom_warning },
    { status: 201 }
  );
}
