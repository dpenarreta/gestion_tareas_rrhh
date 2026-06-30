import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import MyKpisModule from "@/components/kpis/MyKpisModule";

export default async function MyKpisPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <MyKpisModule currentUserName={session.name} currentUserRole={session.role} />;
}
