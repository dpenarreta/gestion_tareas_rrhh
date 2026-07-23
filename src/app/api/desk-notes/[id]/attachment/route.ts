import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canUseDeskNotes } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

// Descarga bajo demanda — el listado de notas nunca incluye attachmentData
// (payload liviano), solo hasAttachment/attachmentName/attachmentMime.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canUseDeskNotes(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const note = await prisma.deskNote.findUnique({
    where: { id },
    select: {
      senderId: true,
      recipientId: true,
      deletedAt: true,
      attachmentName: true,
      attachmentMime: true,
      attachmentData: true,
    },
  });
  if (!note || note.deletedAt || !note.attachmentData) {
    return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  }
  if (note.senderId !== session.userId && note.recipientId !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const base64 = note.attachmentData.split(",")[1] ?? "";
  const buffer = Buffer.from(base64, "base64");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": note.attachmentMime ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${(note.attachmentName ?? "adjunto").replace(/"/g, "")}"`,
    },
  });
}
