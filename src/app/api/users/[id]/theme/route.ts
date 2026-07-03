import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { ThemePreference } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const VALID_THEMES: ThemePreference[] = ["LIGHT", "DARK"];

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (id !== session.userId) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { theme } = await request.json();
  if (!VALID_THEMES.includes(theme)) {
    return NextResponse.json({ error: "theme debe ser LIGHT o DARK" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: { theme: theme as ThemePreference },
    select: { theme: true },
  });

  return NextResponse.json(user);
}
