import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  CONFIG_KEY_HORAS_EFECTIVAS,
  CONFIG_KEY_WORKLOAD_TOLERANCE,
  getEffectiveHorasEfectivas,
  getEffectiveWorkloadTolerance,
  setConfigValue,
} from "@/lib/systemConfig";

const MIN_HOURS = 4;
const MAX_HOURS = 8;
const MIN_TOLERANCE = 0;
const MAX_TOLERANCE = 4;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [hoursPerDay, workloadTolerance] = await Promise.all([
    getEffectiveHorasEfectivas(),
    getEffectiveWorkloadTolerance(),
  ]);
  return NextResponse.json({ hoursPerDay, workloadTolerance });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { hoursPerDay?: number; workloadTolerance?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (body.hoursPerDay === undefined && body.workloadTolerance === undefined) {
    return NextResponse.json({ error: "Nada que guardar" }, { status: 400 });
  }

  const { hoursPerDay, workloadTolerance } = body;

  if (hoursPerDay !== undefined) {
    if (
      typeof hoursPerDay !== "number" ||
      !Number.isFinite(hoursPerDay) ||
      hoursPerDay < MIN_HOURS ||
      hoursPerDay > MAX_HOURS
    ) {
      return NextResponse.json(
        { error: `Las horas efectivas deben ser un número entre ${MIN_HOURS} y ${MAX_HOURS} horas` },
        { status: 400 }
      );
    }
  }

  if (workloadTolerance !== undefined) {
    if (
      typeof workloadTolerance !== "number" ||
      !Number.isFinite(workloadTolerance) ||
      workloadTolerance < MIN_TOLERANCE ||
      workloadTolerance > MAX_TOLERANCE
    ) {
      return NextResponse.json(
        { error: `La tolerancia debe ser un número entre ${MIN_TOLERANCE} y ${MAX_TOLERANCE} horas` },
        { status: 400 }
      );
    }
  }

  await Promise.all([
    hoursPerDay !== undefined
      ? setConfigValue(CONFIG_KEY_HORAS_EFECTIVAS, String(hoursPerDay), session.userId)
      : Promise.resolve(),
    workloadTolerance !== undefined
      ? setConfigValue(CONFIG_KEY_WORKLOAD_TOLERANCE, String(workloadTolerance), session.userId)
      : Promise.resolve(),
  ]);

  const [effectiveHours, effectiveTolerance] = await Promise.all([
    getEffectiveHorasEfectivas(),
    getEffectiveWorkloadTolerance(),
  ]);
  return NextResponse.json({ hoursPerDay: effectiveHours, workloadTolerance: effectiveTolerance });
}
