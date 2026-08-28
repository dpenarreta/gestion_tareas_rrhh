import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import { djangoApiFetch } from "@/lib/djangoSession";
import {
  extractDjangoProjectErrorMessage,
  mapDjangoProjectParticipantToNexoShape,
  type DjangoProjectParticipant,
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
  const { userId } = body as { userId?: string };
  if (!userId) {
    return NextResponse.json({ error: "Falta el usuario a agregar" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/projects/${projectId}/participants/`, {
    method: "POST",
    body: JSON.stringify({ user: Number(userId) }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes permiso para agregar participantes" }, { status: 403 });
  }
  if (response.status === 409) {
    return NextResponse.json({ error: "Este usuario ya es participante del proyecto" }, { status: 409 });
  }
  if (!response.ok) {
    const message = await extractDjangoProjectErrorMessage(response, "Usuario inválido");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const participant: DjangoProjectParticipant = await response.json();
  const mapped = mapDjangoProjectParticipantToNexoShape(participant);
  const canSeeRealEmails = canManageUsers(session.role);
  return NextResponse.json(
    { ...mapped, user: { ...mapped.user, email: maskEmailUnless(mapped.user.email, canSeeRealEmails) } },
    { status: 201 }
  );
}
