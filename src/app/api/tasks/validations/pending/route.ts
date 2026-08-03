import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import type { Role, TaskType } from "@/generated/prisma/client";
import { ALL_ROLES } from "@/lib/roles";
import { getPendingTaskValidations } from "@/lib/taskValidationServer";
import { getTargetTimeDataQuality } from "@/lib/targetTimeServer";
import { getEndDateDataQuality } from "@/lib/endDateServer";

const CAN_REGULARIZE: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL"];

/**
 * Pantalla "Tiempo Objetivo" (Menú lateral → Gestión) — reemplaza los 2
 * endpoints separados (`target-time/pending`, `end-date/pending`) por uno
 * combinado: una tarea aparece si necesita atención en Tiempo Objetivo O en
 * Fecha Fin (o ambas), para que el líder valide integralmente la
 * planificación desde una sola tabla. Mismo gate que ambos predecesores.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!CAN_REGULARIZE.includes(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") || undefined;
  const roleParam = searchParams.get("role") || undefined;
  const typeParam = searchParams.get("type") || undefined;
  const role = roleParam && (ALL_ROLES as string[]).includes(roleParam) ? (roleParam as Role) : undefined;
  const type = typeParam === "FIJA" || typeParam === "SEGUIMIENTO" ? (typeParam as TaskType) : undefined;

  const [tasks, targetTimeDataQuality, endDateDataQuality] = await Promise.all([
    getPendingTaskValidations({ userId, role, type }),
    getTargetTimeDataQuality({ role }),
    getEndDateDataQuality({ role }),
  ]);

  return NextResponse.json({ tasks, targetTimeDataQuality, endDateDataQuality });
}
