import { getSession } from "@/lib/session";
import { ROLE_LEVEL, canUseDeskNotes } from "@/lib/roles";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";
import DashboardModule from "@/components/dashboard/DashboardModule";

const DEFAULT_CARDS = ["jornada", "prioridades", "proyectos", "agenda", "actividad", "comunicados", "escritorio", "acciones", "resumen"];
const DASHBOARD_PREFIX = "DASHBOARD_CARDS:";

// Cutover de stack — Fase 86 (ver docs/AUDIT_LOG.md § 2026-08-28): réplica
// de `GET /users/<id>/view-preferences/` (Django, completo desde la Fase
// 55) llamado directo desde la página, mismo patrón exacto ya usado en
// `tasks/page.tsx`. Sin sesión Django resuelta o con respuesta fallida,
// degrada a `[]` (mismo comportamiento que un usuario sin preferencia
// guardada) en vez de romper la página.
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const djangoUserId = await resolveDjangoUserId(session);
  const viewPreferencesResponse = djangoUserId ? await djangoApiFetch(`/users/${djangoUserId}/view-preferences/`) : null;
  const viewPreferences: string[] =
    viewPreferencesResponse?.ok ? ((await viewPreferencesResponse.json()) as { view_preferences: string[] }).view_preferences : [];

  const dashboardPref = viewPreferences.find((v) => v.startsWith(DASHBOARD_PREFIX));
  const savedOrder = dashboardPref
    ? dashboardPref.slice(DASHBOARD_PREFIX.length).split(",").filter(Boolean)
    : null;

  const cardOrder = savedOrder
    ? [...savedOrder.filter((c) => DEFAULT_CARDS.includes(c)), ...DEFAULT_CARDS.filter((c) => !savedOrder.includes(c))]
    : DEFAULT_CARDS;

  const canPost = ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"].includes(session.role);

  // Bug encontrado en prueba integral en Chrome real (2026-08-31): `userId`
  // llega hasta `TaskFormModal`/`MeetingFormModalDashboard` (acciones
  // rápidas del dashboard) como `currentUserId`, que ambos usan para
  // auto-asignarse/auto-designarse anfitrión cuando no se elige otro
  // usuario — con el cuid de Postgres eso fallaba igual que en
  // Proyectos/Reuniones/Equipo/Tiempo Objetivo. `djangoUserId` ya se
  // resolvía arriba para `view-preferences`, se reusa acá.
  return (
    <DashboardModule
      userId={djangoUserId !== null ? String(djangoUserId) : session.userId}
      userName={session.name}
      userRole={session.role}
      roleLevel={ROLE_LEVEL[session.role]}
      initialCardOrder={cardOrder}
      canPost={canPost}
      canUseDesk={canUseDeskNotes(session.role)}
    />
  );
}
