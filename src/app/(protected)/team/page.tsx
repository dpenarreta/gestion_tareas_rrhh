import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canViewTeam } from "@/lib/roles";
import { fetchDjangoCurrentUserId } from "@/lib/djangoTasksAdapter";
import TeamModule from "@/components/team/TeamModule";

export default async function TeamPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canViewTeam(session.role)) redirect("/dashboard");

  const djangoUserId = await fetchDjangoCurrentUserId();

  return (
    <Suspense fallback={null}>
      <TeamModule currentUserId={djangoUserId ?? String(session.djangoUserId)} currentUserRole={session.role} />
    </Suspense>
  );
}
