import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { extractDjangoDeskErrorMessage } from "@/lib/djangoDeskAdapter";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django (`DeskReminderViewSet.convert_to_task`,
// Fase 7c).
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const response = await djangoApiFetch(`/desk-reminders/${id}/convert-to-task/`, {
    method: "POST",
    body: JSON.stringify({
      title: typeof body.title === "string" ? body.title : undefined,
      type: typeof body.type === "string" ? body.type : undefined,
      frequency: typeof body.frequency === "string" ? body.frequency : undefined,
      start_date: body.startDate,
      end_date: body.endDate,
      estimated_hours: body.estimatedHours,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Recordatorio no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (response.status === 409) {
    return NextResponse.json({ error: "Este recordatorio ya fue convertido en tarea" }, { status: 409 });
  }
  if (!response.ok) {
    const message = await extractDjangoDeskErrorMessage(response, "Faltan campos requeridos");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const data = (await response.json()) as { task_id: number; task_title: string };
  return NextResponse.json({ taskId: String(data.task_id), taskTitle: data.task_title }, { status: 201 });
}
