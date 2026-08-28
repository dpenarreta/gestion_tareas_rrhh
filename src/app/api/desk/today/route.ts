import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoTodayResponse = {
  pending_notes: { id: number; message: string; priority: string; color: string; created_at: string; sender_name: string }[];
  today_reminders: { id: number; title: string; due_at: string; priority: string; overdue: boolean }[];
  upcoming_tasks: { id: number; title: string; end_date: string; priority: string; status: string }[];
  recent_projects: { id: number; name: string; status: string; updated_at: string }[];
};

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django (`DeskTodayView`, Fase 7f) — 4
// bloques de solo lectura, sin cuerpo de request.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const response = await djangoApiFetch("/desk/today/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const data: DjangoTodayResponse = await response.json();
  return NextResponse.json({
    pendingNotes: data.pending_notes.map((n) => ({
      id: String(n.id),
      message: n.message,
      priority: n.priority,
      color: n.color,
      createdAt: n.created_at,
      senderName: n.sender_name,
    })),
    todayReminders: data.today_reminders.map((r) => ({
      id: String(r.id),
      title: r.title,
      dueAt: r.due_at,
      priority: r.priority,
      overdue: r.overdue,
    })),
    upcomingTasks: data.upcoming_tasks.map((t) => ({
      id: String(t.id),
      title: t.title,
      endDate: t.end_date,
      priority: t.priority,
      status: t.status,
    })),
    recentProjects: data.recent_projects.map((p) => ({
      id: String(p.id),
      name: p.name,
      status: p.status,
      updatedAt: p.updated_at,
    })),
  });
}
