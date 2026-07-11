import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageUsers, getVisibleRoles, ROLE_LEVEL } from "@/lib/roles";
import { maskEmail } from "@/lib/mask-email";
import type { Role } from "@/generated/prisma/client";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // El Administrador ve a todos; el resto solo ve a sus subordinados según jerarquía
  // (lo que también excluye siempre al Administrador, invisible para el resto de roles).
  const where = session.role === "ADMINISTRADOR" ? {} : { role: { in: getVisibleRoles(session.role) } };

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      dataConsentAccepted: true,
      dataConsentAcceptedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "El email ya está registrado" }, { status: 409 });
  }

  const password = await bcrypt.hash("123456", 10);

  const user = await prisma.user.create({
    data: { name, email, role: role as Role, password },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return NextResponse.json(user, { status: 201 });
}
