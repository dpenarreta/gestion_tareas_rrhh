import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoNotification = {
  id: number;
  user_id: number;
  message: string;
  task_id: number | null;
  task_title: string | null;
  read: boolean;
  created_at: string;
  task_assigned_to_id: number | null;
};

function mapDjangoNotificationToNexoShape(n: DjangoNotification) {
  return {
    id: String(n.id),
    userId: String(n.user_id),
    message: n.message,
    taskId: n.task_id !== null ? String(n.task_id) : null,
    taskTitle: n.task_title,
    read: n.read,
    createdAt: n.created_at,
    taskAssignedToId: n.task_assigned_to_id !== null ? String(n.task_assigned_to_id) : null,
  };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): `Notification`
// (`notify()`/`notify_many()`) ya la escriben internamente Tareas/Proyectos/
// Escritorio Digital/Reuniones/Ideas/LOPD desde que cada uno se portó a
// Django — esta campana leía Postgres, así que nunca veía ninguna de esas
// notificaciones (bug de staleness activo, mismo patrón que otras fases de
// este cutover). `NotificationListView` (Fase 15 del backend) es réplica
// exacta. `taskAssignedToId` ahora es el id NUMÉRICO de Django (Tareas ya
// cutover) — ver `src/app/(protected)/layout.tsx`, que ahora le pasa
// `session.djangoUserId` (Fase 40) a `NotificationBell`, no el `cuid`.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const response = await djangoApiFetch("/notifications/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data: { notifications: DjangoNotification[]; unread_count: number } = await response.json();
  return NextResponse.json({
    notifications: data.notifications.map(mapDjangoNotificationToNexoShape),
    unreadCount: data.unread_count,
  });
}

export async function PATCH() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const response = await djangoApiFetch("/notifications/", { method: "PATCH" });
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  return NextResponse.json(await response.json());
}
