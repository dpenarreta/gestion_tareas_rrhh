import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoDashboardPayload = {
  priorityTasks: { id: number; [key: string]: unknown }[];
  announcements: { id: number; [key: string]: unknown }[];
  upcomingMeetings: { id: number; [key: string]: unknown }[];
  myProjects: { id: number; [key: string]: unknown }[];
  [key: string]: unknown;
};

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `build_dashboard_payload` (backend, Fase 25, completo) — cierra la
// staleness de Tareas/Proyectos documentada como fuera de alcance desde la
// Fase 44 (Comunicados/Reuniones ya se habían corregido ahí). El payload de
// Django ya usa las mismas claves camelCase que este contrato — solo los 4
// arrays con `id` numérico se convierten a `string` (mismo criterio que el
// resto de esta migración: los tipos del frontend esperan `id: string`).
// `PATCH /api/dashboard/card-order` NO se corta en esta fase — comparte
// `User.viewPreferences` con `favorites` (sin cutover), mismo riesgo de
// divergencia ya documentado desde la Fase 36.
function toNexoShape(data: DjangoDashboardPayload) {
  return {
    ...data,
    priorityTasks: data.priorityTasks.map((t) => ({ ...t, id: String(t.id) })),
    announcements: data.announcements.map((a) => ({ ...a, id: String(a.id) })),
    upcomingMeetings: data.upcomingMeetings.map((m) => ({ ...m, id: String(m.id) })),
    myProjects: data.myProjects.map((p) => ({ ...p, id: String(p.id) })),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/dashboard/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al cargar el dashboard" }, { status: response.status });
  }

  const data = (await response.json()) as DjangoDashboardPayload;
  return NextResponse.json(toNexoShape(data));
}
