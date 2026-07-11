import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageUsers, getVisibleRoles } from "@/lib/roles";

export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canManageUsers(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  // Solo se puede restablecer el consentimiento de usuarios dentro de la propia jerarquía visible
  // (esto también excluye siempre al Administrador para el resto de roles).
  if (session.role !== "ADMINISTRADOR" && !getVisibleRoles(session.role).includes(user.role)) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id },
    data: { dataConsentAccepted: false, dataConsentAcceptedAt: null },
  });

  return NextResponse.json({ ok: true });
}
