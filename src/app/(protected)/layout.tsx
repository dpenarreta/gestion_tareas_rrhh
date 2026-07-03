import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import NavMenu from "@/components/NavMenu";
import NotificationBell from "@/components/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-chrome border-b border-border sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold text-primary">Nexo</span>
            <NavMenu role={session.role} />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle userId={session.userId} />
            <NotificationBell />
            <Link href="/profile" className="text-right hidden sm:block hover:opacity-80 transition-opacity">
              <p className="text-sm font-medium text-title">{session.name}</p>
              <p className="text-[13px] text-secondary">{ROLE_LABEL[session.role]}</p>
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}

function LogoutButton() {
  return (
    <form
      action={async () => {
        "use server";
        const { deleteSession } = await import("@/lib/session");
        const { redirect } = await import("next/navigation");
        await deleteSession();
        redirect("/login");
      }}
    >
      <button
        type="submit"
        className="text-sm text-secondary hover:text-title px-3 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        Salir
      </button>
    </form>
  );
}
