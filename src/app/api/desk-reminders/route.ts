import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { extractDjangoDeskErrorMessage, mapDjangoReminderToNexoShape, type DjangoPersonalReminder } from "@/lib/djangoDeskAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django (`DeskReminderViewSet`) — sin gaps:
// Recordatorios no tiene Papelera (borrado físico, ya resuelto en 7b) ni
// adjunto propio que perder (ver docstring de `apps/desk/models.py`).
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ["status", "from", "to", "limit", "archived"]) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const response = await djangoApiFetch(`/desk-reminders/${suffix}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const reminders: DjangoPersonalReminder[] = await response.json();
  return NextResponse.json(reminders.map(mapDjangoReminderToNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: unknown;
    description?: unknown;
    dueAt?: unknown;
    priority?: unknown;
    repeat?: unknown;
  };

  const response = await djangoApiFetch("/desk-reminders/", {
    method: "POST",
    body: JSON.stringify({
      title: body.title,
      description: typeof body.description === "string" ? body.description : undefined,
      due_at: body.dueAt,
      priority: typeof body.priority === "string" ? body.priority : undefined,
      repeat: typeof body.repeat === "string" ? body.repeat : undefined,
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    const errorMessage = await extractDjangoDeskErrorMessage(response, "Faltan campos requeridos");
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const reminder: DjangoPersonalReminder = await response.json();
  return NextResponse.json(mapDjangoReminderToNexoShape(reminder), { status: 201 });
}
