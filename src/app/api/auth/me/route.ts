import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, createSession } from "@/lib/session";
import { getActivityFormat, withActivityFormat } from "@/lib/activityFormat";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true, createdAt: true, viewPreferences: true },
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
    activityFormat: getActivityFormat(user.viewPreferences),
  });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { name, email, activityFormat } = await request.json();

  const hasProfileFields = name !== undefined || email !== undefined;

  if (hasProfileFields) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }
    if (!email?.trim()) {
      return NextResponse.json({ error: "El correo es requerido" }, { status: 400 });
    }
  }

  if (activityFormat !== undefined && activityFormat !== "duration" && activityFormat !== "timerange") {
    return NextResponse.json({ error: "Formato de actividad inválido" }, { status: 400 });
  }

  const cleanEmail = hasProfileFields ? email.trim().toLowerCase() : null;

  if (cleanEmail && cleanEmail !== session.email) {
    const taken = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (taken) {
      return NextResponse.json({ error: "Ese correo ya está en uso" }, { status: 409 });
    }
  }

  const data: { name?: string; email?: string; viewPreferences?: string[] } = {};
  if (hasProfileFields) {
    data.name = name.trim();
    data.email = cleanEmail!;
  }
  if (activityFormat !== undefined) {
    const current = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { viewPreferences: true },
    });
    data.viewPreferences = withActivityFormat(current?.viewPreferences, activityFormat);
  }

  const user = await prisma.user.update({
    where: { id: session.userId },
    data,
    select: { id: true, name: true, email: true, role: true, createdAt: true, viewPreferences: true },
  });

  if (hasProfileFields) {
    await createSession({ userId: user.id, role: user.role, name: user.name, email: user.email });
  }

  return NextResponse.json({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    activityFormat: getActivityFormat(user.viewPreferences),
  });
}
