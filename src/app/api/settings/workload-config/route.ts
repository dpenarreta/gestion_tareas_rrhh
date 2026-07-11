import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  CONFIG_KEY_HORAS_EFECTIVAS,
  CONFIG_KEY_WORKLOAD_LIMIT_LOW,
  CONFIG_KEY_WORKLOAD_LIMIT_HIGH,
  CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD,
  getEffectiveHorasEfectivas,
  getEffectiveWorkloadLimitLow,
  getEffectiveWorkloadLimitHigh,
  getEffectiveWorkloadLimitOverload,
  setConfigValue,
} from "@/lib/systemConfig";

const MIN_HOURS = 4;
const MAX_HOURS = 8;
const MIN_LIMIT = 0;
const MAX_LIMIT = 24;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [hoursPerDay, workloadLimitLow, workloadLimitHigh, workloadLimitOverload] = await Promise.all([
    getEffectiveHorasEfectivas(),
    getEffectiveWorkloadLimitLow(),
    getEffectiveWorkloadLimitHigh(),
    getEffectiveWorkloadLimitOverload(),
  ]);
  return NextResponse.json({ hoursPerDay, workloadLimitLow, workloadLimitHigh, workloadLimitOverload });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: {
    hoursPerDay?: number;
    workloadLimitLow?: number;
    workloadLimitHigh?: number;
    workloadLimitOverload?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { hoursPerDay, workloadLimitLow, workloadLimitHigh, workloadLimitOverload } = body;

  if (
    hoursPerDay === undefined &&
    workloadLimitLow === undefined &&
    workloadLimitHigh === undefined &&
    workloadLimitOverload === undefined
  ) {
    return NextResponse.json({ error: "Nada que guardar" }, { status: 400 });
  }

  const fields: Array<{ value: number | undefined; label: string; min: number; max: number }> = [
    { value: hoursPerDay, label: "Las horas efectivas", min: MIN_HOURS, max: MAX_HOURS },
    { value: workloadLimitLow, label: "El límite de Subutilización", min: MIN_LIMIT, max: MAX_LIMIT },
    { value: workloadLimitHigh, label: "El límite superior óptimo", min: MIN_LIMIT, max: MAX_LIMIT },
    { value: workloadLimitOverload, label: "El límite de Sobrecarga", min: MIN_LIMIT, max: MAX_LIMIT },
  ];
  for (const f of fields) {
    if (f.value === undefined) continue;
    if (typeof f.value !== "number" || !Number.isFinite(f.value) || f.value < f.min || f.value > f.max) {
      return NextResponse.json(
        { error: `${f.label} debe ser un número entre ${f.min} y ${f.max} horas` },
        { status: 400 },
      );
    }
  }

  // Los 4 límites son independientes entre sí, pero deben mantener un orden
  // coherente (bajo < base <= alto < sobrecarga) o el semáforo por rango
  // queda mal formado — validamos con el valor vigente para cualquier campo
  // que no se esté actualizando en esta llamada.
  const [currentHours, currentLow, currentHigh, currentOverload] = await Promise.all([
    getEffectiveHorasEfectivas(),
    getEffectiveWorkloadLimitLow(),
    getEffectiveWorkloadLimitHigh(),
    getEffectiveWorkloadLimitOverload(),
  ]);
  const finalHours = hoursPerDay ?? currentHours;
  const finalLow = workloadLimitLow ?? currentLow;
  const finalHigh = workloadLimitHigh ?? currentHigh;
  const finalOverload = workloadLimitOverload ?? currentOverload;

  if (!(finalLow < finalHours && finalHours <= finalHigh && finalHigh < finalOverload)) {
    return NextResponse.json(
      {
        error: `Los límites deben mantener el orden: Subutilización (${finalLow}) < Horas efectivas (${finalHours}) <= Límite óptimo (${finalHigh}) < Sobrecarga (${finalOverload})`,
      },
      { status: 400 },
    );
  }

  await Promise.all([
    hoursPerDay !== undefined
      ? setConfigValue(CONFIG_KEY_HORAS_EFECTIVAS, String(hoursPerDay), session.userId)
      : Promise.resolve(),
    workloadLimitLow !== undefined
      ? setConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_LOW, String(workloadLimitLow), session.userId)
      : Promise.resolve(),
    workloadLimitHigh !== undefined
      ? setConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_HIGH, String(workloadLimitHigh), session.userId)
      : Promise.resolve(),
    workloadLimitOverload !== undefined
      ? setConfigValue(CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD, String(workloadLimitOverload), session.userId)
      : Promise.resolve(),
  ]);

  const [effectiveHours, effectiveLow, effectiveHigh, effectiveOverload] = await Promise.all([
    getEffectiveHorasEfectivas(),
    getEffectiveWorkloadLimitLow(),
    getEffectiveWorkloadLimitHigh(),
    getEffectiveWorkloadLimitOverload(),
  ]);
  return NextResponse.json({
    hoursPerDay: effectiveHours,
    workloadLimitLow: effectiveLow,
    workloadLimitHigh: effectiveHigh,
    workloadLimitOverload: effectiveOverload,
  });
}
