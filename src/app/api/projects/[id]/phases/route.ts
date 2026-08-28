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

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { name, status, responsibleId, startDate, targetDate, targetTimeHours, notes } = body as {
    name?: string;
    status?: string;
    responsibleId?: string;
    startDate?: string;
    targetDate?: string;
    targetTimeHours?: number;
    notes?: string;
  };

  const response = await djangoApiFetch(`/projects/${projectId}/phases/`, {
    method: "POST",
    body: JSON.stringify({
      name,
      status: status ?? undefined,
      responsible: responsibleId ? Number(responsibleId) : null,
      start_date: startDate ?? null,
      target_date: targetDate ?? null,
      target_time_hours: targetTimeHours ?? null,
      notes: notes ?? "",
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes permiso para agregar fases" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoProjectErrorMessage(response, "El nombre de la fase es requerido");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const phase: DjangoProjectPhase = await response.json();
  return NextResponse.json(mapDjangoProjectPhaseToNexoShape(phase), { status: 201 });
}
