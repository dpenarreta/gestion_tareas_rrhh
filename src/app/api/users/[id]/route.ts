import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers, canManageTargetUser, ROLE_LEVEL } from "@/lib/roles";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoUserToNexoShape, resolveRoleGroupId, type DjangoUser } from "@/lib/djangoUsersAdapter";
import type { Role } from "@/lib/roles";

// Fase 2 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// esta ruta pasó de Prisma a Django — ver plan de Fase 2 para las
// decisiones explícitas (DELETE ya no es eliminación física).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

const VALID_ROLES: Role[] = [
  "ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS",
  "ANALISTA_CC", "ANALISTA_SELECCION", "ASISTENTE_SELECCION",
  "ASISTENTE_GH", "ASISTENTE_GH_ZS", "TRABAJO_SOCIAL", "ASISTENTE_NOMINA",
];

type Ctx = { params: Promise<{ id: string }> };

async function fetchDjangoUser(id: string): Promise<DjangoUser | null | "no_session"> {
  const response = await djangoApiFetch(`/admin/users/${id}/`);
  if (!response) return "no_session";
  if (!response.ok) return null;
  return response.json();
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const djangoUser = await fetchDjangoUser(id);
  if (djangoUser === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!djangoUser) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const user = mapDjangoUserToNexoShape(djangoUser);
  if (!canManageTargetUser(session, user.role)) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await fetchDjangoUser(id);
  if (existing === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  const targetRole = mapDjangoUserToNexoShape(existing).role;

  // Solo un Administrador puede editar a otro Administrador
  if (targetRole === "ADMINISTRADOR" && session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Solo un Administrador puede editar a otro Administrador" }, { status: 403 });
  }

  // Solo JEFE_NACIONAL o ADMINISTRADOR pueden editar a otro JEFE_NACIONAL
  if (targetRole === "JEFE_NACIONAL" && session.role !== "JEFE_NACIONAL" && session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Solo el Jefe Nacional puede editar a otro Jefe Nacional" }, { status: 403 });
  }

  const { name, email, role } = (await request.json()) as { name?: string; email?: string; role?: string };

  if (role !== undefined) {
    if (!VALID_ROLES.includes(role as Role)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    if (ROLE_LEVEL[role as Role] > ROLE_LEVEL[session.role]) {
      return NextResponse.json({ error: "No puedes asignar un rol superior al tuyo" }, { status: 403 });
    }
  }

  if (name?.trim() || email?.trim()) {
    const profileResponse = await djangoApiFetch(`/admin/users/${id}/`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(name?.trim() && { first_name: name.trim() }),
        ...(email?.trim() && { email: email.trim(), username: email.trim() }),
      }),
    });
    if (!profileResponse) {
      return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
    }
    if (profileResponse.status === 400 || profileResponse.status === 409) {
      return NextResponse.json({ error: "El email ya está en uso por otro usuario" }, { status: 409 });
    }
    if (!profileResponse.ok) {
      return NextResponse.json({ error: "No se pudo guardar los cambios" }, { status: 500 });
    }
  }

  // Django separa el cambio de rol del de perfil, en su propio endpoint
  // (auditoría distinta) — ver apps/users/views.py::roles.
  if (role) {
    const roleId = await resolveRoleGroupId(role);
    if (roleId === null) {
      return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
    }
    const roleResponse = await djangoApiFetch(`/admin/users/${id}/roles/`, {
      method: "POST",
      body: JSON.stringify({ role_ids: [roleId] }),
    });
    if (!roleResponse || !roleResponse.ok) {
      return NextResponse.json({ error: "No se pudo cambiar el rol" }, { status: 500 });
    }
  }

  const updated = await fetchDjangoUser(id);
  if (updated === "no_session" || !updated) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  return NextResponse.json(mapDjangoUserToNexoShape(updated));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;

  if (id === session.userId) {
    return NextResponse.json({ error: "No puedes eliminarte a ti mismo" }, { status: 400 });
  }

  const existing = await fetchDjangoUser(id);
  if (existing === "no_session") {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (!canManageTargetUser(session, mapDjangoUserToNexoShape(existing).role)) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  // Decisión explícita de Fase 2: skelleton_base no permite eliminación
  // física de usuarios (solo baja lógica) — ver plan de Fase 2.
  const response = await djangoApiFetch(`/admin/users/${id}/disable/`, { method: "POST" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo deshabilitar el usuario" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
