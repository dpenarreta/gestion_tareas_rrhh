import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ id: string }> };

type DjangoSpecialStatus = {
  id: number;
  userId: number;
  user: { id: number; name: string };
  type: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  dailyHours: number;
  limitLow: number;
  limitBase: number;
  limitHigh: number;
  limitOverload: number;
};

function toNexoShape(r: DjangoSpecialStatus) {
  return { ...r, id: String(r.id), userId: String(r.userId), user: { ...r.user, id: String(r.user.id) } };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `SpecialStatusDetailView` (backend, Fase 29, completo). `PATCH` finaliza
// el estado especial hoy (o antes, si su fecha fin ya estaba en el
// pasado) — nunca lo extiende.
export async function PATCH(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/settings/special-status/${id}/`, { method: "PATCH" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Estado especial no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al finalizar el estado especial" }, { status: response.status });
  }

  const data = (await response.json()) as DjangoSpecialStatus;
  return NextResponse.json(toNexoShape(data));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/settings/special-status/${id}/`, { method: "DELETE" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Estado especial no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al eliminar el estado especial" }, { status: response.status });
  }

  return NextResponse.json({ ok: true });
}
