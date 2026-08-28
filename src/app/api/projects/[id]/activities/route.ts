import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  extractDjangoProjectErrorMessage,
  mapDjangoProjectActivityToNexoShape,
  type DjangoProjectActivity,
} from "@/lib/djangoProjectsAdapter";

// Fase 5f de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// esta ruta pasó de Prisma a Django. `recalc_project_real_hours` y el
// alta automática como participante ya los resuelve
// `ActivityService.create_activity` del lado Django (Fase 5e).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${projectId}/activities/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudieron obtener las actividades" }, { status: 400 });
  }

  const activities: DjangoProjectActivity[] = await response.json();
  return NextResponse.json(activities.map(mapDjangoProjectActivityToNexoShape));
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { description, comments, startTime, endTime, phaseId, activityDate } = body as {
    description?: string;
    comments?: string;
    startTime?: string;
    endTime?: string;
    phaseId?: string;
    activityDate?: string;
  };

  const response = await djangoApiFetch(`/projects/${projectId}/activities/`, {
    method: "POST",
    body: JSON.stringify({
      description,
      comments: comments ?? "",
      start_time: startTime,
      end_time: endTime,
      phase: phaseId ? Number(phaseId) : null,
      activity_date: activityDate ?? null,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json(
      { error: "Solo los participantes del proyecto pueden registrar actividades" },
      { status: 403 }
    );
  }
  if (!response.ok) {
    const message = await extractDjangoProjectErrorMessage(response, "No se pudo registrar la actividad");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const activity: DjangoProjectActivity = await response.json();
  return NextResponse.json(mapDjangoProjectActivityToNexoShape(activity), { status: 201 });
}
