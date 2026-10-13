import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { DjangoUnavailableError, djangoApiFetch } from "@/lib/djangoSession";

const UNAVAILABLE_MESSAGE = "El servicio de NEXO no está disponible temporalmente.";

/** La campana consulta cada 30 s: si Django no responde, un 503 con JSON
 * (no una excepción sin manejar). Otros errores siguen su curso normal. */
async function fetchOrUnavailable(path: string, init?: RequestInit) {
  try {
    return await (init ? djangoApiFetch(path, init) : djangoApiFetch(path));
  } catch (err) {
    if (err instanceof DjangoUnavailableError) return "unavailable" as const;
    throw err;
  }
}

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoNotification = {
  id: number;
  user_id: number;
  message: string;
  task_id: number | null;
  task_title: string | null;
  read: boolean;
  category?: string;
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
    category: n.category ?? "",
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

  const response = await fetchOrUnavailable("/notifications/");
  if (response === "unavailable") {
    return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  if (!response || response.status === 401) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    // Un error de Django no es "sesión vencida": se informa con su código.
    return NextResponse.json({ error: "No se pudieron cargar las notificaciones." }, { status: response.status });
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

  const response = await fetchOrUnavailable("/notifications/", { method: "PATCH" });
  if (response === "unavailable") {
    return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  if (!response || response.status === 401) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudieron actualizar las notificaciones." }, { status: response.status });
  }

  return NextResponse.json(await response.json());
}
