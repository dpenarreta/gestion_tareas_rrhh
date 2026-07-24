import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLE_LEVEL, canUseDeskNotes } from "@/lib/roles";
import DashboardModule from "@/components/dashboard/DashboardModule";

const DEFAULT_CARDS = ["jornada", "prioridades", "proyectos", "agenda", "actividad", "comunicados", "escritorio", "acciones", "resumen"];
const DASHBOARD_PREFIX = "DASHBOARD_CARDS:";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { viewPreferences: true },
  });

  const dashboardPref = (user?.viewPreferences ?? []).find((v) => v.startsWith(DASHBOARD_PREFIX));
  const savedOrder = dashboardPref
    ? dashboardPref.slice(DASHBOARD_PREFIX.length).split(",").filter(Boolean)
    : null;

  const cardOrder = savedOrder
    ? [...savedOrder.filter((c) => DEFAULT_CARDS.includes(c)), ...DEFAULT_CARDS.filter((c) => !savedOrder.includes(c))]
    : DEFAULT_CARDS;

  const canPost = ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"].includes(session.role);

  return (
    <DashboardModule
      userId={session.userId}
      userName={session.name}
      userRole={session.role}
      roleLevel={ROLE_LEVEL[session.role]}
      initialCardOrder={cardOrder}
      canPost={canPost}
      canUseDesk={canUseDeskNotes(session.role)}
    />
  );
}
