import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (id !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { viewPreferences } = await request.json();
  if (!Array.isArray(viewPreferences) || viewPreferences.length === 0) {
    return NextResponse.json({ error: "viewPreferences debe ser un array con al menos una vista" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: { viewPreferences },
    select: { viewPreferences: true },
  });

  return NextResponse.json(user);
}
