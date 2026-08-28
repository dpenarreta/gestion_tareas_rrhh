import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoPredictivePayloadToNexoShape } from "@/lib/djangoPredictiveAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ userId: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `SimulateAdjustTargetTimeView` (backend, Fase 9c) — escenario "modificar
// tiempo objetivo" de una tarea. `AdjustTargetTimeSimulationSerializer` ya
// replica la validación de rango (0-1000) — el `route.ts` solo traduce
// camelCase→snake_case. Nunca persiste nada, igual que el original.
export async function POST(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const { taskId, newTargetTimeHours } = (body ?? {}) as { taskId?: unknown; newTargetTimeHours?: unknown };

  const response = await djangoApiFetch(`/predictive/simulate/${userId}/`, {
    method: "POST",
    body: JSON.stringify({ task_id: taskId, new_target_time_hours: newTargetTimeHours }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Usuario o tarea no encontrados" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Escenario inválido" }, { status: 400 });
  }

  const payload = mapDjangoPredictivePayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
