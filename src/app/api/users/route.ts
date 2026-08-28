import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageUsers, getVisibleRoles, ROLE_LEVEL } from "@/lib/roles";
import { maskEmail } from "@/lib/mask-email";
import { djangoApiFetch } from "@/lib/djangoSession";
import { fetchAllDjangoUsers, mapDjangoUserToNexoShape, resolveRoleGroupId } from "@/lib/djangoUsersAdapter";
import type { Role } from "@/lib/roles";

// Fase 2 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-07):
// esta ruta pasó de leer/escribir Prisma directamente a hablar con el
// backend Django, traduciendo la forma de los datos — el frontend
// (UsersManager.tsx) sigue recibiendo exactamente lo mismo que antes.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const djangoUsers = await fetchAllDjangoUsers();
  if (djangoUsers === null) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  let users = djangoUsers.map(mapDjangoUserToNexoShape);

  // El Administrador ve a todos; el resto solo a sus subordinados según
  // jerarquía (post-filtro aquí porque Django todavía no conoce
  // apps.hierarchy — ver plan de Fase 2).
  if (session.role !== "ADMINISTRADOR") {
    const visible = getVisibleRoles(session.role);
    users = users.filter((u) => visible.includes(u.role));
  }

  return NextResponse.json(users.map((u) => ({ ...u, email: maskEmail(u.email) })));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { name, email, role } = await request.json();

  if (!name || !email || !role) {
    return NextResponse.json({ error: "Todos los campos son requeridos" }, { status: 400 });
  }

  if (ROLE_LEVEL[role as Role] > ROLE_LEVEL[session.role]) {
    return NextResponse.json({ error: "No puedes asignar un rol superior al tuyo" }, { status: 403 });
  }

  const roleId = await resolveRoleGroupId(role);
  if (roleId === null) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  // "123456" no cumple los validadores de contraseña heredados de
  // skelleton_base (mínimo 10 caracteres, no puede ser solo numérica) — ver
  // decisión explícita en el plan de Fase 2.
  const response = await djangoApiFetch("/admin/users/", {
    method: "POST",
    body: JSON.stringify({
      username: email,
      email,
      first_name: name,
      password: "NexoTemporal2026!",
      role_ids: [roleId],
    }),
  });

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  if (response.status === 409 || response.status === 400) {
    const data = await response.json().catch(() => null);
    const emailTaken =
      typeof data?.error?.details?.email !== "undefined" || typeof data?.email !== "undefined";
    return NextResponse.json(
      { error: emailTaken ? "El email ya está registrado" : "No se pudo crear el usuario" },
      { status: 409 }
    );
  }

  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo crear el usuario" }, { status: 500 });
  }

  const created = mapDjangoUserToNexoShape(await response.json());
  return NextResponse.json(created, { status: 201 });
}
