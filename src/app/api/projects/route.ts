import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  extractDjangoProjectErrorMessage,
  mapDjangoProjectListItemToNexoShape,
  type DjangoProjectListItem,
} from "@/lib/djangoProjectsAdapter";

// Fase 5f de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// esta ruta pasó de Prisma a Django. La lista NO trae `email` de
// responsable/creador (mismo criterio que el legacy: `projectListSelect`
// nunca lo seleccionaba), así que no hace falta enmascarar acá.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const response = await djangoApiFetch("/projects/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo obtener la lista de proyectos" }, { status: 400 });
  }

  const projects: DjangoProjectListItem[] = await response.json();
  return NextResponse.json(projects.map(mapDjangoProjectListItemToNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const {
    name,
    description,
    responsibleId,
    participantIds,
    startDate,
    targetDate,
    status,
    priority,
    targetTimeHours,
    tags,
    area,
    observations,
  } = body;

  if (!name || !responsibleId || !startDate || !targetDate || !priority || targetTimeHours == null) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch("/projects/", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: description ?? "",
      responsible: Number(responsibleId),
      participant_ids: Array.isArray(participantIds) ? participantIds.map(Number) : [],
      start_date: startDate,
      target_date: targetDate,
      status: status ?? undefined,
      priority,
      target_time_hours: targetTimeHours,
      tags: Array.isArray(tags) ? tags : [],
      area: area ?? "",
      observations: observations ?? "",
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes permiso para crear proyectos" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoProjectErrorMessage(response, "No se pudo crear el proyecto");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // El ViewSet de Django responde con `ProjectDetailSerializer` (superset de
  // `ProjectListSerializer`), pero el frontend (`CreateProjectModal.onCreated`)
  // espera exactamente la forma `ProjectListItem` — mismo criterio que el
  // legacy Prisma, que ya devolvía `projectListSelect` (no el detalle) en el
  // POST.
  const created: DjangoProjectListItem = await response.json();
  return NextResponse.json(mapDjangoProjectListItemToNexoShape(created), { status: 201 });
}
