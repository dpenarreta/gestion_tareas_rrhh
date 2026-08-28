import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoWorkloadConfig = {
  hours_per_day: number;
  workload_limit_low: number;
  workload_limit_high: number;
  workload_limit_overload: number;
};

function toNexoShape(data: DjangoWorkloadConfig) {
  return {
    hoursPerDay: data.hours_per_day,
    workloadLimitLow: data.workload_limit_low,
    workloadLimitHigh: data.workload_limit_high,
    workloadLimitOverload: data.workload_limit_overload,
  };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `WorkloadConfigView` (backend, Fase 31, completo) — ya consumida por el
// bundle de Analytics/Dashboard desde la Fase 4m; esta config seguía
// editándose en Postgres, sin ningún efecto real desde entonces (gap
// preexistente, cerrado acá).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/workload-config/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = (await response.json()) as DjangoWorkloadConfig;
  return NextResponse.json(toNexoShape(data));
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
  const payload: Record<string, number> = {};
  if (hoursPerDay !== undefined) payload.hours_per_day = hoursPerDay;
  if (workloadLimitLow !== undefined) payload.workload_limit_low = workloadLimitLow;
  if (workloadLimitHigh !== undefined) payload.workload_limit_high = workloadLimitHigh;
  if (workloadLimitOverload !== undefined) payload.workload_limit_overload = workloadLimitOverload;

  const response = await djangoApiFetch("/settings/workload-config/", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = (await response.json()) as DjangoWorkloadConfig;
  return NextResponse.json(toNexoShape(data));
}
