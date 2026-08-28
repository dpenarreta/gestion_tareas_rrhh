import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import { maskEmailUnless } from "@/lib/mask-email";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import {
  extractDjangoProjectErrorMessage,
  mapDjangoProjectDetailToNexoShape,
  type DjangoProjectDetail,
} from "@/lib/djangoProjectsAdapter";

// Fase 5f de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// GET/PATCH pasaron de Prisma a Django. DELETE ("mover a la papelera")
// se cortó también en el cutover de stack (ver docs/AUDIT_LOG.md §
// 2026-08-21), junto con el resto de la Papelera de Proyectos
// (`trash/route.ts`, `[id]/restore/route.ts`, `[id]/permanent/route.ts`) —
// cierra el gap documentado desde la Fase 5f (un proyecto creado después de
// ese cutover solo existía en SQL Server, y la Papelera en Postgres nunca
// podía verlo).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${id}/`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo obtener el proyecto" }, { status: 400 });
  }

  const project: DjangoProjectDetail = await response.json();
  const mapped = mapDjangoProjectDetailToNexoShape(project);
  const canSeeRealEmails = canManageUsers(session.role);
  return NextResponse.json({
    ...mapped,
    responsible: { ...mapped.responsible, email: maskEmailUnless(mapped.responsible.email, canSeeRealEmails) },
    participants: mapped.participants.map((p) => ({
      ...p,
      user: { ...p.user, email: maskEmailUnless(p.user.email, canSeeRealEmails) },
    })),
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;
  const { name, description, area, tags, observations, startDate, targetDate, targetTimeHours, priority, status, responsibleId } =
    body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description ?? "";
  if (area !== undefined) data.area = area ?? "";
  if (tags !== undefined) data.tags = tags;
  if (observations !== undefined) data.observations = observations ?? "";
  if (startDate !== undefined) data.start_date = startDate;
  if (targetDate !== undefined) data.target_date = targetDate;
  if (targetTimeHours !== undefined) data.target_time_hours = targetTimeHours;
  if (priority !== undefined) data.priority = priority;
  if (status !== undefined) data.status = status;
  if (responsibleId !== undefined) data.responsible = Number(responsibleId);

  const response = await djangoApiFetch(`/projects/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "No tienes permiso para modificar este proyecto" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoProjectErrorMessage(response, "No se pudo actualizar el proyecto");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const project: DjangoProjectDetail = await response.json();
  return NextResponse.json(mapDjangoProjectDetailToNexoShape(project));
}

/** Mueve el proyecto a la papelera (Centro de Recuperación) — no es un
 * borrado físico. `ProjectViewSet.destroy` (Django) ya registra el evento
 * de `ProjectHistory` internamente (`ProjectService.soft_delete_project`). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/projects/${id}/`, { method: "DELETE" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Solo el creador del proyecto puede enviarlo a la papelera" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Error al mover a la papelera" }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
