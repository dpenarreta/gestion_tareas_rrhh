import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import PreventiveIntelligenceModule from "@/components/inteligencia-preventiva/PreventiveIntelligenceModule";

export default async function InteligenciaPreventivaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <PreventiveIntelligenceModule
      currentUserId={session.userId}
      currentUserRole={session.role}
      currentUserName={session.name}
    />
  );
}
