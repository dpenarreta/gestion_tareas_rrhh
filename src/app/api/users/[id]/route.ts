import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageUsers, ROLE_LEVEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

const VALID_ROLES: Role[] = [
  "ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS",
  "ANALISTA_CC", "ANALISTA_SELECCION", "ASISTENTE_SELECCION",
  "ASISTENTE_GH", "ASISTENTE_GH_ZS", "TRABAJO_SOCIAL", "ASISTENTE_NOMINA",
];

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  // El Administrador es invisible para el resto de roles.
  if (user.role === "ADMINISTRADOR" && session.role !== "ADMINISTRADOR") {
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

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  // Solo un Administrador puede editar a otro Administrador
  if (target.role === "ADMINISTRADOR" && session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Solo un Administrador puede editar a otro Administrador" }, { status: 403 });
  }

  // Solo JEFE_NACIONAL o ADMINISTRADOR pueden editar a otro JEFE_NACIONAL
  if (target.role === "JEFE_NACIONAL" && session.role !== "JEFE_NACIONAL" && session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Solo el Jefe Nacional puede editar a otro Jefe Nacional" }, { status: 403 });
  }

  const { name, email, role } = await request.json() as { name?: string; email?: string; role?: string };

  // Validar que el rol destino no supere el nivel del editor
  if (role !== undefined) {
    if (!VALID_ROLES.includes(role as Role)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    if (ROLE_LEVEL[role as Role] > ROLE_LEVEL[session.role]) {
      return NextResponse.json({ error: "No puedes asignar un rol superior al tuyo" }, { status: 403 });
    }
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name?.trim() && { name: name.trim() }),
        ...(email?.trim() && { email: email.trim() }),
        ...(role && { role: role as Role }),
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    return NextResponse.json(user);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "El email ya está en uso por otro usuario" }, { status: 409 });
    }
    throw err;
  }
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

  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  // Solo un Administrador puede eliminar a otro Administrador
  if (target.role === "ADMINISTRADOR" && session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
