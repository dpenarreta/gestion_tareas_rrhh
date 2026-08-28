import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoSystemInfo = {
  version: string;
  commit_sha: string | null;
  server_started_at: string;
  total_users: number;
  total_tasks: number;
  total_meetings: number;
  total_ideas: number;
};

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): `SystemInfoView`
// (backend, Fase 32) cuenta Usuarios/Tareas/Reuniones/Ideas — los 4 modelos
// son 100% Django desde sus respectivos cutovers, así que la versión Prisma
// venía devolviendo conteos desactualizados. `version`/`commitSha` pasan a
// reflejar el backend Django (`APP_VERSION`/`GIT_COMMIT_SHA`), no
// `package.json` de Next.js — 2 apps distintas en esta migración, cada una
// con su propio versionado.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/system-info/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener la información del sistema" }, { status: response.status });
  }

  const data = (await response.json()) as DjangoSystemInfo;
  return NextResponse.json({
    version: data.version,
    commitSha: data.commit_sha,
    serverStartedAt: data.server_started_at,
    totalUsers: data.total_users,
    totalTasks: data.total_tasks,
    totalMeetings: data.total_meetings,
    totalIdeas: data.total_ideas,
  });
}
