import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { ALL_ROLES } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";

type Ctx = { params: Promise<{ id: string }> };

function validRoles(input: unknown): Role[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const roles = input.filter((r): r is Role => ALL_ROLES.includes(r as Role));
  return roles.length === input.length ? roles : null;
}

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

  const data: {
    label?: string;
    description?: string | null;
    assignedRoles?: Role[];
    isActive?: boolean;
    isArchived?: boolean;
    archivedAt?: Date | null;
  } = {};

  if (label !== undefined) {
    if (!label.trim()) {
      return NextResponse.json({ error: "El nombre del motivo es obligatorio" }, { status: 400 });
    }
    data.label = label.trim();
  }
  if (description !== undefined) {
    data.description = description?.trim() || null;
  }
  if (assignedRoles !== undefined) {
    const roles = validRoles(assignedRoles);
    if (!roles) {
      return NextResponse.json({ error: "Selecciona al menos un rol válido" }, { status: 400 });
    }
    data.assignedRoles = roles;
  }
  if (isActive !== undefined) {
    data.isActive = Boolean(isActive);
  }
  // Archivar retira el motivo del listado principal (sin borrarlo) y lo
  // fuerza a no-seleccionable; restaurar solo lo devuelve al listado — no
  // reactiva automáticamente su selectabilidad.
  if (isArchived !== undefined) {
    data.isArchived = Boolean(isArchived);
    data.archivedAt = isArchived ? new Date() : null;
    if (isArchived) data.isActive = false;
  }

  const existing = await prisma.activityReason.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Motivo no encontrado" }, { status: 404 });
  }

  const updated = await prisma.activityReason.update({ where: { id }, data });
  return NextResponse.json(updated);
}
