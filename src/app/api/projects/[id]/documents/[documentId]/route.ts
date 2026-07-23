import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canViewProject } from "@/lib/projectAccess";

type Ctx = { params: Promise<{ id: string; documentId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id: projectId, documentId } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      responsibleId: true,
      createdById: true,
      participants: { select: { userId: true } },
    },
  });
  if (!project) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (!canViewProject(session, project, project.participants.map((p) => p.userId))) {
    return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
  }

  const document = await prisma.projectDocument.findUnique({
    where: { id: documentId },
    select: { id: true, projectId: true, fileName: true, mimeType: true, fileData: true },
  });
  if (!document || document.projectId !== projectId) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }

  return NextResponse.json(document);
}
