import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoPredictivePayloadToNexoShape } from "@/lib/djangoPredictiveAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type Ctx = { params: Promise<{ projectId: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `SimulateAddParticipantsView` (backend, Fase 9c) — escenario "agregar
// participantes" a nivel de proyecto. Nunca persiste nada.
export async function POST(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { projectId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const { additionalParticipants } = (body ?? {}) as { additionalParticipants?: unknown };

  const response = await djangoApiFetch(`/predictive/simulate/project/${projectId}/`, {
    method: "POST",
    body: JSON.stringify({ additional_participants: additionalParticipants }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Escenario inválido" }, { status: 400 });
  }

  const payload = mapDjangoPredictivePayloadToNexoShape(await response.json());
  return NextResponse.json(payload);
}
