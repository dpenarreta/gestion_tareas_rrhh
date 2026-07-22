import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isLeadershipRole } from "@/lib/roles";
import MyKpisModule from "@/components/kpis/MyKpisModule";

export default async function MyKpisPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Roles de dirección no tienen vista de actividad individual — la pestaña
  // no existe en Analytics para ellos, y esta ruta directa tampoco debe
  // resolver a nada (ver isLeadershipRole en roles.ts).
  if (isLeadershipRole(session.role)) redirect("/kpis");

  return <MyKpisModule currentUserId={session.userId} currentUserName={session.name} currentUserRole={session.role} />;
}
