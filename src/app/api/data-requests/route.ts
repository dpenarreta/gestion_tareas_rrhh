import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { DataRequestType } from "@/generated/prisma/client";

const VALID_TYPES: DataRequestType[] = ["ACCESO", "RECTIFICACION", "ELIMINACION"];

const TYPE_LABEL: Record<DataRequestType, string> = {
  ACCESO: "acceso a mis datos",
  RECTIFICACION: "rectificación de datos",
  ELIMINACION: "eliminación de cuenta",
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const isAdmin = session.role === "ADMINISTRADOR";

  const requests = await prisma.dataSubjectRequest.findMany({
    where: isAdmin ? undefined : { userId: session.userId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      resolver: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { type?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { type, description } = body;
  if (!type || !VALID_TYPES.includes(type as DataRequestType)) {
    return NextResponse.json({ error: "Tipo de solicitud inválido" }, { status: 400 });
  }

  const dataRequest = await prisma.dataSubjectRequest.create({
    data: {
      userId: session.userId,
      type: type as DataRequestType,
      description: description?.trim() || null,
    },
  });

  // El acceso directo se resuelve al instante desde /api/data-requests/my-data;
  // solo rectificación y eliminación requieren gestión manual del Administrador.
  if (type !== "ACCESO") {
    const admins = await prisma.user.findMany({
      where: { role: "ADMINISTRADOR" },
      select: { id: true },
    });
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          message: `${session.name} solicitó ${TYPE_LABEL[type as DataRequestType]}`,
        })),
      });
    }
  }

  return NextResponse.json(dataRequest, { status: 201 });
}
