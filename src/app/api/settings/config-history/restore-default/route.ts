import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { setConfigValue } from "@/lib/systemConfig";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { defaults?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const defaults = body.defaults;
  if (!defaults || typeof defaults !== "object" || Object.keys(defaults).length === 0) {
    return NextResponse.json({ error: "defaults es requerido" }, { status: 400 });
  }

  await Promise.all(
    Object.entries(defaults).map(([key, value]) => setConfigValue(key, value, session.userId))
  );

  return NextResponse.json({ ok: true });
}
