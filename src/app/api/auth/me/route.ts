import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, createSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { name, email } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
  }
  if (!email?.trim()) {
    return NextResponse.json({ error: "El correo es requerido" }, { status: 400 });
  }

  const cleanEmail = email.trim().toLowerCase();

  if (cleanEmail !== session.email) {
    const taken = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (taken) {
      return NextResponse.json({ error: "Ese correo ya está en uso" }, { status: 409 });
    }
  }

  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { name: name.trim(), email: cleanEmail },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  await createSession({ userId: user.id, role: user.role, name: user.name, email: user.email });

  return NextResponse.json({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  });
}
