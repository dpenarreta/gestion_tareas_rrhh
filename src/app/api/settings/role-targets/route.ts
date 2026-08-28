import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ALL_ROLES, ROLE_LABEL, canManageUsers } from "@/lib/roles";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import type { Role } from "@/lib/roles";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type RoleTarget = { performance: number | null; riesgoMax: number | null; cumplimiento: number | null };
type DjangoRoleTarget = { performance: number | null; riesgo_max: number | null; cumplimiento: number | null };
type DjangoRoleTargetsResponse = { targets: Record<string, DjangoRoleTarget> };

function toNexoTargets(targets: Record<string, DjangoRoleTarget>): Record<string, RoleTarget> {
  return Object.fromEntries(
    Object.entries(targets).map(([role, t]) => [
      role,
      { performance: t.performance, riesgoMax: t.riesgo_max, cumplimiento: t.cumplimiento },
    ])
  );
}

/**
 * Objetivo esperado del cargo (§Sprint 7) — configuración OPCIONAL usada
 * únicamente como referencia en el Benchmark Personal (Django,
 * `analytics/benchmarks/[userId]`, Fase 22/47 — el único caller real que le
 * quedaba del lado Next.js, `analytics.ts::runAnalyticsPipeline`, es código
 * muerto desde la Fase 47, ver docs/AUDIT_LOG.md § 2026-08-24).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/role-targets/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = (await response.json()) as DjangoRoleTargetsResponse;
  return NextResponse.json({ targets: toNexoTargets(data.targets), roles: ALL_ROLES, roleLabels: ROLE_LABEL });
}

function isValidTarget(body: unknown): body is RoleTarget {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const checkField = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100);
  return checkField(b.performance) && checkField(b.riesgoMax) && checkField(b.cumplimiento);
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const { role, target } = (body ?? {}) as { role?: string; target?: unknown };
  if (!role || !ALL_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: `Cargo desconocido: ${role}` }, { status: 400 });
  }
  if (!isValidTarget(target)) {
    return NextResponse.json({ error: "Objetivo inválido: cada campo debe ser un número entre 0 y 100, o null" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/role-targets/", {
    method: "PATCH",
    body: JSON.stringify({
      role,
      target: { performance: target.performance, riesgo_max: target.riesgoMax, cumplimiento: target.cumplimiento },
    }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = (await response.json()) as DjangoRoleTargetsResponse;
  return NextResponse.json({ targets: toNexoTargets(data.targets) });
}
