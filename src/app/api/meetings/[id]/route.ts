import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoMeetingToNexoShape, type DjangoMeeting } from "@/lib/djangoMeetingsAdapter";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django. `MeetingDetailView` (backend, Fase 10) replica el mismo
// criterio del TS: sin excepción para Administrador, ni en GET (solo
// anfitrión/invitado) ni en PATCH/DELETE (solo anfitrión).
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/meetings/${id}/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener la reunión" }, { status: 500 });
  }

  const meeting: DjangoMeeting = await response.json();
  return NextResponse.json(mapDjangoMeetingToNexoShape(meeting));
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo de solicitud inválido" }, { status: 400 });

  const allowed = ["title", "description", "meetingDate", "duration", "status", "otterInvited", "otterSummary", "otterTranscriptUrl"] as const;
  const fieldMap: Record<(typeof allowed)[number], string> = {
    title: "title",
    description: "description",
    meetingDate: "meeting_date",
    duration: "duration",
    status: "status",
    otterInvited: "otter_invited",
    otterSummary: "otter_summary",
    otterTranscriptUrl: "otter_transcript_url",
  };
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[fieldMap[key]] = body[key];
  }

  const response = await djangoApiFetch(`/meetings/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Solo el anfitrión puede editar la reunión" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al actualizar la reunión" }, { status: 500 });
  }

  const meeting: DjangoMeeting = await response.json();
  return NextResponse.json(mapDjangoMeetingToNexoShape(meeting));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/meetings/${id}/`, { method: "DELETE" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Solo el anfitrión puede eliminar la reunión" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al eliminar la reunión" }, { status: 500 });
  }

  return NextResponse.json(await response.json());
}
