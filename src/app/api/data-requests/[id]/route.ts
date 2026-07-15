import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { DataRequestStatus } from "@/generated/prisma/client";

const VALID_STATUSES: DataRequestStatus[] = ["PENDIENTE", "EN_PROCESO", "RESUELTA"];

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { status } = body;
  if (!status || !VALID_STATUSES.includes(status as DataRequestStatus)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const existing = await prisma.dataSubjectRequest.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  }

  const resolved = status === "RESUELTA";
  const updated = await prisma.dataSubjectRequest.update({
    where: { id },
    data: {
      status: status as DataRequestStatus,
      resolvedBy: resolved ? session.userId : null,
      resolvedAt: resolved ? new Date() : null,
    },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      resolver: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(updated);
}
