import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-26, Fase 76): réplica de
// `FavoritesView` (backend, Fase 28, completo) — comparte `User.view_preferences`
// con `dashboard/card-order` (Django, cortado desde la Fase 55). Hasta este
// cutover, ambos endpoints leían/escribían el MISMO array desde 2 bases
// distintas (Postgres vía `configFavorites.ts` acá, Django allá) — riesgo de
// divergencia activo, mismo patrón de bug real que el cerrado en la Fase 52.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/favorites/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener favoritos" }, { status: response.status });
  }

  const data = (await response.json()) as { favorites: string[] };
  return NextResponse.json({ favorites: data.favorites });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { settingId?: string; pinned?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (typeof body.settingId !== "string" || !body.settingId || typeof body.pinned !== "boolean") {
    return NextResponse.json({ error: "settingId y pinned son requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/favorites/", {
    method: "PATCH",
    body: JSON.stringify({ setting_id: body.settingId, pinned: body.pinned }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "settingId y pinned son requeridos" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
