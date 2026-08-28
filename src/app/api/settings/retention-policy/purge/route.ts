import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { deleteFromGithub } from "@/lib/githubDocuments";
import { safeLog } from "@/lib/logger";
import { executeDjangoPurge, fetchPurgePreview } from "@/lib/djangoRetentionAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack — Fase 83 (ver docs/AUDIT_LOG.md § 2026-08-27): réplica
// de `RetentionPolicyPurgeView` (backend, nueva en esta fase). Ambos
// métodos exigen ADMINISTRADOR en el `route.ts` (réplica exacta del
// original) — Django repite el mismo guard del lado suyo por defensa en
// profundidad, no porque el `route.ts` dependa de eso.

/** Vista previa: cuenta los registros que se eliminarían con la política vigente, sin borrar nada. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const response = await fetchPurgePreview();
  if (!response) return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  if (!response.ok) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const data = (await response.json()) as { reportsToDelete: number; tasksToDelete: number; docsToDelete: number };
  return NextResponse.json({
    reportsToDelete: data.reportsToDelete,
    tasksToDelete: data.tasksToDelete,
    docsToDelete: data.docsToDelete,
  });
}

/** Ejecuta la depuración: elimina lo que supera la política vigente y deja registro de auditoría. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { confirm?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json({ error: "Falta confirmación explícita para ejecutar la depuración" }, { status: 400 });
  }

  const response = await executeDjangoPurge();
  if (!response) return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  if (!response.ok) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const data = (await response.json()) as {
    reportsDeleted: number;
    tasksDeleted: number;
    docsDeleted: number;
    deletedDocs: { githubPath: string; githubSha: string }[];
  };

  // Limpieza de GitHub best-effort, DESPUÉS de que Django ya borró en la
  // base — reordenado respecto del `retentionPolicy.ts` original (que
  // borraba de GitHub antes), sin cambiar el resultado: ya era no
  // bloqueante ahí (`.catch()`), sigue siéndolo acá.
  for (const doc of data.deletedDocs) {
    if (doc.githubPath && doc.githubSha) {
      await deleteFromGithub(doc.githubPath, doc.githubSha).catch((err) =>
        safeLog("error", "[retention-policy/purge] no se pudo eliminar el documento de GitHub durante la depuración", err)
      );
    }
  }

  return NextResponse.json({
    reportsDeleted: data.reportsDeleted,
    tasksDeleted: data.tasksDeleted,
    docsDeleted: data.docsDeleted,
  });
}
