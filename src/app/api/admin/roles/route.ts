import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchDjangoRoles, mapDjangoRoleToNexoShape } from "@/lib/djangoRolesAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// `GET /api/v1/admin/roles/` — pantalla "Roles y Permisos" (ver
// docs/AUDIT_LOG.md § 2026-09-01). Django ya gatea el endpoint real por
// `roles.ver` (`RolesPermission`) — no se duplica el chequeo acá, mismo
// criterio que el resto de rutas que solo listan.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const roles = await fetchDjangoRoles();
  if (roles === null) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  return NextResponse.json(roles.map(mapDjangoRoleToNexoShape));
}
