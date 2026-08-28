import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { mapDjangoTeamMemberTaskToNexoShape, type DjangoTeamMemberTask } from "@/lib/djangoTeamAdapter";

type Ctx = { params: Promise<{ userId: string }> };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): esta ruta pasó de
// Prisma a Django. Nota heredada de la Fase 3a (ver `route.ts` original):
// no se migró en el cutover de Tareas porque Django solo exponía las
// tareas del propio usuario autenticado, no las de un tercero —
// `TeamMemberTasksView` (Fase 18 del backend) es la réplica Django de ese
// mismo caso especial, ya completa. Cierra staleness: leía Postgres,
// desactualizado desde el cutover de Tareas.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { userId } = await ctx.params;
  const response = await djangoApiFetch(`/team/${userId}/tasks/`);
  if (!response) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }
  if (response.status === 403) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Sin permisos" }, { status: 403 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "No se pudieron obtener las tareas" }, { status: 400 });
  }

  const tasks: DjangoTeamMemberTask[] = await response.json();
  return NextResponse.json(tasks.map(mapDjangoTeamMemberTaskToNexoShape));
}
