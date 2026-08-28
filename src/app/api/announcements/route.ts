import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoAnnouncement = {
  id: number;
  title: string;
  content: string;
  authorId: number;
  author: { name: string; role: string };
  pinned: boolean;
  expiresAt: string;
  createdAt: string;
};

function mapDjangoAnnouncementToNexoShape(a: DjangoAnnouncement) {
  return {
    id: String(a.id),
    title: a.title,
    content: a.content,
    authorId: String(a.authorId),
    author: a.author,
    pinned: a.pinned,
    expiresAt: a.expiresAt,
    createdAt: a.createdAt,
  };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django. La visibilidad de a quién notificar (todos los usuarios
// visibles, excluyendo al autor) ya vive en
// `apps.announcements.services.create_announcement`.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/announcements/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const announcements: DjangoAnnouncement[] = await response.json();
  return NextResponse.json(announcements.map(mapDjangoAnnouncementToNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { title, content, durationDays, pinned } = await request.json();

  const response = await djangoApiFetch("/announcements/", {
    method: "POST",
    body: JSON.stringify({ title, content, durationDays, pinned }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Faltan campos requeridos" }, { status: 400 });
  }

  const created: DjangoAnnouncement = await response.json();
  return NextResponse.json(mapDjangoAnnouncementToNexoShape(created), { status: 201 });
}
