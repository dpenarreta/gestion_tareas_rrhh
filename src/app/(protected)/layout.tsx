import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLE_LABEL } from "@/lib/roles";
import { logoutAction } from "@/lib/actions";
import AppShell from "@/components/shell/AppShell";
import ConsentGate from "@/components/ConsentGate";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { dataConsentAccepted: true },
  });

  return (
    <ConsentGate initialAccepted={user?.dataConsentAccepted ?? false}>
      <AppShell
        role={session.role}
        userId={session.userId}
        userName={session.name}
        roleLabel={ROLE_LABEL[session.role]}
        onLogout={logoutAction}
      >
        {children}
      </AppShell>
    </ConsentGate>
  );
}
