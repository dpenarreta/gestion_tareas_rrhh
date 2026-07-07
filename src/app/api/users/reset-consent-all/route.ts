import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function PATCH() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json(
      { error: "Solo un Administrador puede restablecer el consentimiento de todos los usuarios" },
      { status: 403 }
    );
  }

  const result = await prisma.user.updateMany({
    data: { dataConsentAccepted: false, dataConsentAcceptedAt: null },
  });

  return NextResponse.json({ ok: true, count: result.count });
}
