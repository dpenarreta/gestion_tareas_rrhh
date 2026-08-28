import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoPredictivePayloadToNexoShape } from "@/lib/djangoPredictiveAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `SimulateRedistributeLoadView` (backend, Fase 9c) — escenario
// "redistribuir carga", bi-usuario. Nunca persiste nada.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { fromUserId, toUserId, hours } = (body ?? {}) as {
    fromUserId?: unknown;
    toUserId?: unknown;
    hours?: unknown;
  };

  const response = await djangoApiFetch("/predictive/simulate/redistribute/", {
    method: "POST",
    body: JSON.stringify({ from_user_id: fromUserId, to_user_id: toUserId, hours }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
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
