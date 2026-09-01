import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchDjangoPermissionCatalog } from "@/lib/djangoRolesAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// `GET /api/v1/admin/permissions/` — catálogo completo de permisos, de
// solo lectura (`PERMISSION_CATALOG`, ver docs/AUDIT_LOG.md § 2026-09-01).
// Proxy directo: la forma del catálogo (label/description/permissions por
// módulo) ya es la que necesita la pantalla, sin mapeo snake_case→camelCase
// (las claves son codenames y labels, no campos de un modelo).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const catalog = await fetchDjangoPermissionCatalog();
  if (catalog === null) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  return NextResponse.json(catalog);
}
