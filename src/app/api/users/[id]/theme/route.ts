import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";

type Ctx = { params: Promise<{ id: string }> };

const VALID_THEMES = ["LIGHT", "DARK"];

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): `User.theme` ya se
// lee desde Django en `src/app/layout.tsx` — escribir acá en Postgres
// dejaba el cambio de tema sin ningún efecto visible tras recargar. `id`
// (path param) es el id numérico de Django (siempre "yo mismo", nunca otro
// usuario) — se resuelve una sola vez y se reusa para el guard y para
// llamar a `UserThemeView`, que exige `pk == request.user.id`.
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

  const { theme } = await request.json();
  if (!VALID_THEMES.includes(theme)) {
    return NextResponse.json({ error: "theme debe ser LIGHT o DARK" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/users/${djangoUserId}/theme/`, {
    method: "PATCH",
    body: JSON.stringify({ theme }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "theme debe ser LIGHT o DARK" }, { status: 400 });
  }

  return NextResponse.json(await response.json());
}
