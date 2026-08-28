import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoMyDataExportToNexoShape } from "@/lib/djangoDataRequestsAdapter";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): esta ruta pasó de
// Prisma a Django. Tareas/Actividades/Comentarios/Reuniones/Ideas/Votos ya
// se escriben exclusivamente en Django desde sus respectivos cutovers — la
// versión anterior exportaba datos de Postgres cada vez más incompletos
// para un archivo de exportación LOPD (compliance), no solo un widget de
// UI. GAP HEREDADO del backend (`apps.data_requests.services.export_my_data`,
// Fase 12): `usuario` no incluye `theme`/`viewPreferences`/`badges`/
// `dataConsentAccepted`/`dataConsentAcceptedAt` — campos sin equivalente
// todavía en el `User` de Django (gaps ya documentados en fases previas).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/data-requests/my-data/");
  if (!response || !response.ok) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  const exportPayload = mapDjangoMyDataExportToNexoShape(await response.json());

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="nexo-mis-datos-${session.userId}.json"`,
    },
  });
}
