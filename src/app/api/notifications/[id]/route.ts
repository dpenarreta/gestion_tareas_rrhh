import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

type Ctx = { params: Promise<{ id: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): mismo motivo que
// `notifications/route.ts`. `NotificationDetailView` (Fase 15 del backend)
// replica el mismo comportamiento silencioso del TS: si el id no existe o
// pertenece a otro usuario, no hace nada y de todas formas responde
// `{ok: true}`, sin 404/403.
export async function PATCH(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const response = await djangoApiFetch(`/notifications/${id}/`, { method: "PATCH" });
  if (!response || !response.ok) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  return NextResponse.json(await response.json());
}
