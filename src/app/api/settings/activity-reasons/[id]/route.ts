import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ALL_ROLES } from "@/lib/roles";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { mapDjangoActivityReasonToNexoShape, type DjangoActivityReason } from "@/lib/djangoTasksAdapter";
import type { Role } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

function validRoles(input: unknown): Role[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const roles = input.filter((r): r is Role => ALL_ROLES.includes(r as Role));
  return roles.length === input.length ? roles : null;
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): mismo motivo que
// `settings/activity-reasons/route.ts` (POST) — el `id` que llega acá ya es
// el id numérico de Django, porque el listado que lo origina (`GET
// /api/activity-reasons`) lee de Django desde la Fase 3b.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { label, description, assignedRoles, isActive, isArchived } = body as {
    label?: string;
    description?: string | null;
    assignedRoles?: unknown;
    isActive?: boolean;
    isArchived?: boolean;
  };

  if (label !== undefined && !label.trim()) {
    return NextResponse.json({ error: "El nombre del motivo es obligatorio" }, { status: 400 });
  }
  let roles: Role[] | null | undefined;
  if (assignedRoles !== undefined) {
    roles = validRoles(assignedRoles);
    if (!roles) {
      return NextResponse.json({ error: "Selecciona al menos un rol válido" }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  if (label !== undefined) data.label = label.trim();
  if (description !== undefined) data.description = description;
  if (roles !== undefined) data.assigned_roles = roles;
  if (isActive !== undefined) data.is_active = Boolean(isActive);
  if (isArchived !== undefined) data.is_archived = Boolean(isArchived);

  const response = await djangoApiFetch(`/settings/activity-reasons/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Motivo no encontrado" }, { status: 404 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "El nombre del motivo es obligatorio" }, { status: 400 });
  }

  const reason = (await response.json()) as DjangoActivityReason;
  return NextResponse.json(mapDjangoActivityReasonToNexoShape(reason));
}
