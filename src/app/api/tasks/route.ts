import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { fetchOwnDjangoTasks, mapDjangoTaskToNexoShape } from "@/lib/djangoTasksAdapter";

// Fase 3a de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// esta ruta pasó de Prisma a Django. Gap explícito y documentado: la
// notificación al asignado ("`{name}` te asignó la tarea") todavía no se
// replica (el modelo Notification no existe en Django en esta sub-fase).
// La invalidación de caché de Analytics (`invalidateAnalyticsCache`) se
// omite a propósito: el motor de Analytics sigue leyendo Postgres, que
// esta ruta ya no toca.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const tasks = await fetchOwnDjangoTasks();
  if (tasks === null) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  return NextResponse.json(tasks.map(mapDjangoTaskToNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { title, priority, frequency, startDate, endDate, estimatedHours, assignedToId } = body;

  if (!title || !priority || !frequency || !startDate || !endDate || !estimatedHours || !assignedToId) {
    return NextResponse.json({ error: "Todos los campos son requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch("/tasks/", {
    method: "POST",
    body: JSON.stringify({
      title,
      description: body.description ?? "",
      priority,
      frequency,
      type: body.type ?? "FIJA",
      status: body.status ?? "PENDIENTE",
      start_date: startDate,
      end_date: endDate,
      estimated_hours: estimatedHours,
      assigned_to: Number(assignedToId),
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo crear la tarea" }, { status: 400 });
  }

  const created = mapDjangoTaskToNexoShape(await response.json());
  return NextResponse.json(created, { status: 201 });
}
