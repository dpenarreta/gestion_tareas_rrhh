import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoViewPreferences = { view_preferences: string[] };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-25): réplica de
// `UserViewPreferencesView` (backend, Fase 55, nueva). Réplica FIEL de un
// bug preexistente del TS legacy, documentado y deliberadamente NO
// corregido acá: reemplaza `viewPreferences` por completo, sin fusionar
// con otras claves de prefijo (`ACTIVITY_FORMAT:`/`DASHBOARD_CARDS:`/
// `CONFIG_FAVORITE:`) que convivan en el mismo array.
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const djangoUserId = await resolveDjangoUserId(session);
  if (djangoUserId === null) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (id !== String(djangoUserId)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { viewPreferences } = await request.json();
  if (!Array.isArray(viewPreferences) || viewPreferences.length === 0) {
    return NextResponse.json({ error: "viewPreferences debe ser un array con al menos una vista" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/users/${djangoUserId}/view-preferences/`, {
    method: "PATCH",
    body: JSON.stringify({ viewPreferences }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudieron guardar las preferencias" }, { status: 400 });
  }

  const data = (await response.json()) as DjangoViewPreferences;
  return NextResponse.json({ viewPreferences: data.view_preferences });
}
