import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ALL_ROLES } from "@/lib/roles";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { mapDjangoActivityReasonToNexoShape, type DjangoActivityReason } from "@/lib/djangoTasksAdapter";
import type { Role } from "@/lib/roles";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

function validRoles(input: unknown): Role[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const roles = input.filter((r): r is Role => ALL_ROLES.includes(r as Role));
  return roles.length === input.length ? roles : null;
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta ruta pasó de
// Prisma a Django (`POST /settings/activity-reasons/`). El único consumidor
// real del catálogo (`GET /api/activity-reasons`) ya lee de Django desde la
// Fase 3b — escribir acá en Postgres dejaba el alta de motivos sin ningún
// efecto visible en el resto de la app (bug preexistente, no introducido acá).
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { label, description, assignedRoles } = body as {
    label?: string;
    description?: string;
    assignedRoles?: unknown;
  };

  if (!label?.trim()) {
    return NextResponse.json({ error: "El nombre del motivo es obligatorio" }, { status: 400 });
  }
  const roles = validRoles(assignedRoles);
  if (!roles) {
    return NextResponse.json({ error: "Selecciona al menos un rol válido" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/activity-reasons/", {
    method: "POST",
    body: JSON.stringify({ label: label.trim(), description, assigned_roles: roles }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "El nombre del motivo es obligatorio" }, { status: 400 });
  }

  const reason = (await response.json()) as DjangoActivityReason;
  return NextResponse.json(mapDjangoActivityReasonToNexoShape(reason), { status: 201 });
}
