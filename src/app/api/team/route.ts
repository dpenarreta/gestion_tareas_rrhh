import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoTeamMemberToNexoShape, type DjangoTeamMember } from "@/lib/djangoTeamAdapter";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): esta ruta pasó de
// Prisma a Django. `TeamListView` (Fase 18 del backend) ya enmascara el
// email (`mask_email`) y arma el conteo de tareas por estado — el
// `route.ts` no repite esa lógica. Cierra staleness: los conteos de tareas
// leían Postgres, desactualizado desde el cutover de Tareas.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const response = await djangoApiFetch("/team/");
  if (!response) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudo obtener el equipo" }, { status: 400 });
  }

  const members: DjangoTeamMember[] = await response.json();
  return NextResponse.json(members.map(mapDjangoTeamMemberToNexoShape));
}
