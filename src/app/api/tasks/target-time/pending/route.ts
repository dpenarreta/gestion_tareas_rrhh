import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import type { Role, TaskType } from "@/generated/prisma/client";
import { ALL_ROLES } from "@/lib/roles";
import { getPendingTargetTimeTasks, getTargetTimeDataQuality } from "@/lib/targetTimeServer";

const CAN_REGULARIZE: Role[] = ["ADMINISTRADOR", "JEFE_NACIONAL"];

/**
 * Herramienta "Regularizar tiempos objetivo" (§Sprint 6 S6-D) — lista tareas
 * activas o recientes SIN Tiempo Objetivo validado, con filtros por
 * colaborador/cargo/tipo. Solo Administrador y Jefe Nacional. Nunca modifica
 * horas reales ni recalcula automáticamente — solo lista para decisión humana.
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
    getPendingTargetTimeTasks({ userId, role, type }),
    getTargetTimeDataQuality({ role }),
  ]);

  return NextResponse.json({ tasks, dataQuality });
}
