import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { mapDjangoDeskNoteToNexoShape, type DjangoDeskNote } from "@/lib/djangoDeskAdapter";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS = ["read", "pin", "unpin", "archive", "unarchive"] as const;
type Action = (typeof ACTIONS)[number];

// Fase 7g de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-18):
// GET/PATCH pasaron a Django. DELETE se queda en Prisma — mismo gap que
// Proyectos (Fase 5f): el borrado real de una nota pasa por el Centro de
// Recuperación (`recoveryCenter.ts`, tabla `RecoveryItem` propia en
// Postgres), pieza transversal sin portar (ver docs/ROADMAP.md punto 13).
// Si se hubiera cortado, una nota enviada a la papelera nunca aparecería
// en el Centro de Recuperación (que no lee SQL Server) — quedaría
// "perdida". Consecuencia aceptada: para una nota creada DESPUÉS de este
// cutover (que solo existe en SQL Server), este DELETE devuelve 404
// "Nota no encontrada" (Postgres nunca tuvo esa fila) hasta que la
// Papelera se porte a Django.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/desk-notes/${id}/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const note: DjangoDeskNote = await response.json();
  return NextResponse.json(mapDjangoDeskNoteToNexoShape(note));
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const action = body?.action as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/desk-notes/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const updated = (await response.json()) as { id: number; read: boolean; pinned: boolean; archived: boolean };
  return NextResponse.json({ id: String(updated.id), read: updated.read, pinned: updated.pinned, archived: updated.archived });
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `DeskNoteViewSet.destroy` (backend, Fase 14, completo desde entonces —
// `apps.recovery`/`ENTITY_REGISTRY` con adaptador DESK_NOTE ya resuelto el
// mismo gap que bloqueaba este cutover). Dos vías de eliminación, distintas
// en actor y mecanismo, ambas resueltas en Django (`DeskNoteService.
// trash_note`/`delete_archived_note_permanently`): el remitente envía a la
// papelera (reversible, sin UI de restauración todavía — mismo gap real que
// tenía el TS, `listActiveTrash("DESK_NOTE")` nunca tuvo caller); el
// destinatario borra definitivamente una nota YA archivada.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/desk-notes/${id}/`, { method: "DELETE" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Error al eliminar" }, { status: response.status === 409 ? 409 : 400 });
  }

  return NextResponse.json({ success: true });
}
