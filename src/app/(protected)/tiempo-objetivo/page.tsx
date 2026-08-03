import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import RegularizeValidationsTabs from "@/components/tasks/RegularizeValidationsTabs";

export default async function TargetTimePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMINISTRADOR" && session.role !== "JEFE_NACIONAL") redirect("/dashboard");

  return <RegularizeValidationsTabs currentUserId={session.userId} />;
}
