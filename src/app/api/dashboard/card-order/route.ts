import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25): réplica de
// `DashboardCardOrderView` (backend, Fase 25, completo) — comparte
// `User.view_preferences` con `favorites` (Django, Fase 28). `favorites`
// (`src/app/api/settings/favorites/route.ts`) siguió en Postgres hasta la
// Fase 76 — hasta entonces, ambos endpoints leían/escribían 2 copias
// distintas del mismo array (Postgres vs. Django), riesgo real, no solo
// documentado.
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { order } = await request.json();
  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: "order debe ser un array no vacío" }, { status: 400 });
  }

  const response = await djangoApiFetch("/dashboard/card-order/", {
    method: "PATCH",
    body: JSON.stringify({ order }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "order debe ser un array no vacío" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
