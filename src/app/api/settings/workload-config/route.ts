import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  CONFIG_KEY_HORAS_EFECTIVAS,
  getEffectiveHorasEfectivas,
  setConfigValue,
} from "@/lib/systemConfig";

const MIN_HOURS = 4;
const MAX_HOURS = 8;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const hoursPerDay = await getEffectiveHorasEfectivas();
  return NextResponse.json({ hoursPerDay });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { hoursPerDay?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const hoursPerDay = body.hoursPerDay;
  if (
    typeof hoursPerDay !== "number" ||
    !Number.isFinite(hoursPerDay) ||
    hoursPerDay < MIN_HOURS ||
    hoursPerDay > MAX_HOURS ||
    Math.round(hoursPerDay * 2) !== hoursPerDay * 2
  ) {
    return NextResponse.json(
      { error: `El valor debe ser un número entre ${MIN_HOURS} y ${MAX_HOURS}, en pasos de 0.5` },
      { status: 400 }
    );
  }

  await setConfigValue(CONFIG_KEY_HORAS_EFECTIVAS, String(hoursPerDay), session.userId);
  return NextResponse.json({ hoursPerDay });
}
