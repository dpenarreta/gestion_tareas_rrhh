import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import type { Role, TaskType } from "@/generated/prisma/client";
import { ALL_ROLES } from "@/lib/roles";
import { getPendingEndDateTasks, getEndDateDataQuality } from "@/lib/endDateServer";

const CAN_REGULARIZE: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL"];

/**
 * Herramienta "Regularizar Fecha Fin" — lista tareas activas o recientes
 * cuya Fecha Fin sigue Pendiente de validación, con filtros por
 * colaborador/cargo/tipo. Solo Administrador y Jefe Nacional — mismo gate
 * que target-time/pending.
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

  const [tasks, dataQuality] = await Promise.all([
    getPendingEndDateTasks({ userId, role, type }),
    getEndDateDataQuality({ role }),
  ]);

  return NextResponse.json({ tasks, dataQuality });
}
