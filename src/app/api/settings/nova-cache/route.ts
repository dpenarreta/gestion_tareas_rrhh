import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getEffectiveNovaCacheTtlMinutes, setNovaCacheTtlMinutes } from "@/lib/systemConfig";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const cacheTtlMinutes = await getEffectiveNovaCacheTtlMinutes();
  return NextResponse.json({ cacheTtlMinutes });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { cacheTtlMinutes?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { cacheTtlMinutes } = body;
  if (cacheTtlMinutes === undefined || !Number.isInteger(cacheTtlMinutes) || cacheTtlMinutes < 1 || cacheTtlMinutes > 10080) {
    return NextResponse.json({ error: "El TTL de caché debe ser un entero entre 1 y 10080 minutos (7 días)" }, { status: 400 });
  }

  await setNovaCacheTtlMinutes(cacheTtlMinutes, session.userId);
  const effective = await getEffectiveNovaCacheTtlMinutes();
  return NextResponse.json({ cacheTtlMinutes: effective });
}
