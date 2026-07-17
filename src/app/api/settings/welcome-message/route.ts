import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getEffectiveWelcomeMessage,
  getEffectiveWelcomeMessageActive,
  CONFIG_KEY_WELCOME_MESSAGE,
  CONFIG_KEY_WELCOME_MESSAGE_ACTIVE,
  setConfigValue,
} from "@/lib/systemConfig";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [message, active] = await Promise.all([
    getEffectiveWelcomeMessage(),
    getEffectiveWelcomeMessageActive(),
  ]);
  return NextResponse.json({ message, active });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { message, active } = body as { message?: string; active?: boolean };
  if (typeof message !== "string" || typeof active !== "boolean") {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  await Promise.all([
    setConfigValue(CONFIG_KEY_WELCOME_MESSAGE, message.trim(), session.userId),
    setConfigValue(CONFIG_KEY_WELCOME_MESSAGE_ACTIVE, String(active), session.userId),
  ]);

  return NextResponse.json({ message: message.trim(), active });
}
