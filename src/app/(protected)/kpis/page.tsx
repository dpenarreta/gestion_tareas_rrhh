import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canViewTeam } from "@/lib/roles";
import AnalyticsModule from "@/components/kpis/AnalyticsModule";

export default async function KpisPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canViewTeam(session.role)) redirect("/dashboard");

  return (
    <AnalyticsModule
      currentUserId={session.userId}
      currentUserRole={session.role}
      currentUserName={session.name}
    />
  );
}
