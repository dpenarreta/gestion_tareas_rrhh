import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoSearchResponse = {
  notes: {
    id: number;
    message: string;
    priority: string;
    color: string;
    read: boolean;
    archived: boolean;
    created_at: string;
    sender_id: number;
    sender_name: string;
    recipient_id: number;
    recipient_name: string;
    is_mine: boolean;
    reply_count: number;
  }[];
  reminders: { id: number; title: string; description: string | null; due_at: string; priority: string; status: string }[];
};

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// esta ruta pasó de Prisma a Django (`DeskSearchView`, Fase 7f) —
// buscador único, mismos nombres de query param que el TS original
// (q/priority/date/sender/recipient/status), passthrough directo.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ["q", "priority", "date", "sender", "recipient", "status"]) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const response = await djangoApiFetch(`/desk/search/${suffix}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const data: DjangoSearchResponse = await response.json();
  return NextResponse.json({
    notes: data.notes.map((n) => ({
      id: String(n.id),
      message: n.message,
      priority: n.priority,
      color: n.color,
      read: n.read,
      archived: n.archived,
      createdAt: n.created_at,
      senderId: String(n.sender_id),
      senderName: n.sender_name,
      recipientId: String(n.recipient_id),
      recipientName: n.recipient_name,
      isMine: n.is_mine,
      replyCount: n.reply_count,
    })),
    reminders: data.reminders.map((r) => ({
      id: String(r.id),
      title: r.title,
      description: r.description,
      dueAt: r.due_at,
      priority: r.priority,
      status: r.status,
    })),
  });
}
