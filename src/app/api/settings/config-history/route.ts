import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const keysParam = request.nextUrl.searchParams.get("keys");
  const keys = (keysParam ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    return NextResponse.json({ error: "keys es requerido" }, { status: 400 });
  }

  const rows = await prisma.systemConfigHistory.findMany({
    where: { key: { in: keys } },
    orderBy: { validFrom: "desc" },
    include: { updater: { select: { name: true } } },
  });

  return NextResponse.json(
    rows.map((r) => ({
      key: r.key,
      value: r.value,
      validFrom: r.validFrom.toISOString(),
      validUntil: r.validUntil?.toISOString() ?? null,
      updatedByName: r.updater.name,
    }))
  );
}
