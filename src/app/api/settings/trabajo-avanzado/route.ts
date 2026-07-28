import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getEffectiveRetroactiveWindowDays,
  setRetroactiveWindowDays,
  getEffectiveWorkdayEndHour,
  setWorkdayEndHour,
} from "@/lib/systemConfig";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [retroactiveWindowDays, workdayEndHour] = await Promise.all([
    getEffectiveRetroactiveWindowDays(),
    getEffectiveWorkdayEndHour(),
  ]);
  return NextResponse.json({ retroactiveWindowDays, workdayEndHour });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { retroactiveWindowDays?: number; workdayEndHour?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { retroactiveWindowDays, workdayEndHour } = body;

  if (retroactiveWindowDays !== undefined) {
    if (!Number.isInteger(retroactiveWindowDays) || retroactiveWindowDays < 1 || retroactiveWindowDays > 10) {
      return NextResponse.json({ error: "La ventana de registro retroactivo debe ser un entero entre 1 y 10 días" }, { status: 400 });
    }
  }
  if (workdayEndHour !== undefined) {
    if (!Number.isInteger(workdayEndHour) || workdayEndHour < 0 || workdayEndHour > 23) {
      return NextResponse.json({ error: "La hora de corte de jornada debe ser un entero entre 0 y 23" }, { status: 400 });
    }
  }

  await Promise.all([
    retroactiveWindowDays !== undefined ? setRetroactiveWindowDays(retroactiveWindowDays, session.userId) : Promise.resolve(),
    workdayEndHour !== undefined ? setWorkdayEndHour(workdayEndHour, session.userId) : Promise.resolve(),
  ]);

  const [effectiveWindow, effectiveHour] = await Promise.all([
    getEffectiveRetroactiveWindowDays(),
    getEffectiveWorkdayEndHour(),
  ]);
  return NextResponse.json({ retroactiveWindowDays: effectiveWindow, workdayEndHour: effectiveHour });
}
