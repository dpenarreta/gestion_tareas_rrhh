import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { ALL_ROLES } from "@/lib/roles";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import type { Role } from "@/generated/prisma/client";

const DIACRITICS_RE = /[̀-ͯ]/g;

function slugifyKey(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "MOTIVO";
}

function validRoles(input: unknown): Role[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const roles = input.filter((r): r is Role => ALL_ROLES.includes(r as Role));
  return roles.length === input.length ? roles : null;
}

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

  const baseKey = slugifyKey(label.trim());
  let key = baseKey;
  let suffix = 2;
  while (await prisma.activityReason.findUnique({ where: { key } })) {
    key = `${baseKey}_${suffix}`;
    suffix++;
  }

  const reason = await prisma.activityReason.create({
    data: {
      key,
      label: label.trim(),
      description: description?.trim() || null,
      assignedRoles: roles,
    },
  });

  // assignedRoles determina qué actividades puede seleccionar cada rol —
  // afecta el índice de trazabilidad/consistencia de Analytics (Sprint D,
  // antes faltaba en este endpoint; ver docs/AUDIT_LOG.md § Sprint D).
  invalidateAnalyticsCache();

  return NextResponse.json(reason, { status: 201 });
}
