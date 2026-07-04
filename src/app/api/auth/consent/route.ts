import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function PATCH() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { dataConsentAccepted: true, dataConsentAcceptedAt: new Date() },
    select: { dataConsentAccepted: true, dataConsentAcceptedAt: true },
  });

  return NextResponse.json(user);
}
