import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  extractDjangoProjectErrorMessage,
  mapDjangoProjectPhaseToNexoShape,
  type DjangoProjectPhase,
} from "@/lib/djangoProjectsAdapter";

// Fase 5f de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// esta ruta pasó de Prisma a Django.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string; phaseId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId, phaseId } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { name, status, responsibleId, startDate, targetDate, targetTimeHours, notes, progress } = body as {
    name?: string;
    status?: string;
    responsibleId?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
    targetTimeHours?: number | null;
    notes?: string | null;
    progress?: number;
  };

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (status !== undefined) data.status = status;
  if (responsibleId !== undefined) data.responsible = responsibleId ? Number(responsibleId) : null;
  if (startDate !== undefined) data.start_date = startDate;
  if (targetDate !== undefined) data.target_date = targetDate;
  if (targetTimeHours !== undefined) data.target_time_hours = targetTimeHours;
  if (notes !== undefined) data.notes = notes ?? "";
  if (progress !== undefined) data.progress = progress;

  const response = await djangoApiFetch(`/projects/${projectId}/phases/${phaseId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Fase no encontrada" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes permiso para modificar fases" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoProjectErrorMessage(response, "El progreso debe estar entre 0 y 100");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const phase: DjangoProjectPhase = await response.json();
  return NextResponse.json(mapDjangoProjectPhaseToNexoShape(phase));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId, phaseId } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${projectId}/phases/${phaseId}/`, { method: "DELETE" });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Fase no encontrada" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes permiso para eliminar fases" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo eliminar la fase" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
