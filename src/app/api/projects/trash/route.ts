import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canCreateProject } from "@/lib/roles";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoProjectTrashItemToNexoShape, type DjangoProjectTrashItem } from "@/lib/djangoProjectsAdapter";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): cierra el gap
// explícito de la Fase 5f — desde que `projects/route.ts`/`projects/[id]/route.ts`
// se cortaron a Django, cualquier proyecto creado después solo existía en
// SQL Server, y esta Papelera (leyendo Postgres) nunca podía mostrarlo.
// `ProjectViewSet.trash` (Fase 14 del backend) es réplica exacta, ya
// resuelta contra el mismo `apps.recovery` que enviará ahí los proyectos.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!canCreateProject(session.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const response = await djangoApiFetch("/projects/trash/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo obtener la papelera" }, { status: 400 });
  }

  const items: DjangoProjectTrashItem[] = await response.json();
  return NextResponse.json(items.map(mapDjangoProjectTrashItemToNexoShape));
}
