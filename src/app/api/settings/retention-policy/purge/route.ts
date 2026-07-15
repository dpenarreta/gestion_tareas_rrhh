import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { findPurgeCandidates, executePurge } from "@/lib/retentionPolicy";

/** Vista previa: cuenta los registros que se eliminarían con la política vigente, sin borrar nada. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { policy, reportIds, taskIds, docIds } = await findPurgeCandidates();
  return NextResponse.json({
    policy,
    reportsToDelete: reportIds.length,
    tasksToDelete: taskIds.length,
    docsToDelete: docIds.length,
  });
}

/** Ejecuta la depuración: elimina lo que supera la política vigente y deja registro de auditoría. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { confirm?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json({ error: "Falta confirmación explícita para ejecutar la depuración" }, { status: 400 });
  }

  const result = await executePurge(session.userId);
  return NextResponse.json(result);
}
