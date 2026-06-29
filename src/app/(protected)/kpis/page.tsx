import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canViewTeam } from "@/lib/roles";
import KpisModule from "@/components/kpis/KpisModule";

export default async function KpisPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canViewTeam(session.role)) redirect("/dashboard");

  return <KpisModule currentUserId={session.userId} currentUserRole={session.role} />;
}
