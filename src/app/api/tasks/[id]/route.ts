import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { fetchDjangoTask, mapDjangoTaskToNexoShape } from "@/lib/djangoTasksAdapter";

// Fase 3a de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// esta ruta pasó de Prisma a Django. Gaps explícitos y documentados en
// esta sub-fase: el reinicio automático de la aprobación de Fecha Fin al
// editar `endDate` (`endDateApprovalStatus`) no se replica todavía —
// Django no tiene esos campos de gobierno hasta la sub-fase de validación.
// La invalidación de caché de Analytics se omite (el motor sigue leyendo
// Postgres, que esta ruta ya no toca).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

const FIELD_MAP: Record<string, string> = {
  title: "title",
  description: "description",
  type: "type",
  status: "status",
  priority: "priority",
  frequency: "frequency",
  startDate: "start_date",
  endDate: "end_date",
  estimatedHours: "estimated_hours",
  realHours: "real_hours",
  assignedToId: "assigned_to",
  color: "color",
};

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const existing = await fetchDjangoTask(id);
  if (existing === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }
  if (existing.archived_month) {
    return NextResponse.json({ error: "Tarea archivada, de solo lectura" }, { status: 403 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const djangoBody: Record<string, unknown> = {};
  for (const [nexoField, djangoField] of Object.entries(FIELD_MAP)) {
    if (nexoField in body) {
      djangoBody[djangoField] =
        djangoField === "assigned_to" ? Number(body[nexoField]) : body[nexoField];
    }
  }

  const response = await djangoApiFetch(`/tasks/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(djangoBody),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos para editar esta tarea" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json(
      { error: "Solo el responsable de la tarea puede editar ese campo" },
      { status: 400 }
    );
  }

  return NextResponse.json(mapDjangoTaskToNexoShape(await response.json()));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const existing = await fetchDjangoTask(id);
  if (existing === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }
  if (existing.archived_month) {
    return NextResponse.json({ error: "Tarea archivada, de solo lectura" }, { status: 403 });
  }

  const response = await djangoApiFetch(`/tasks/${id}/`, { method: "DELETE" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos para eliminar" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo eliminar la tarea" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
