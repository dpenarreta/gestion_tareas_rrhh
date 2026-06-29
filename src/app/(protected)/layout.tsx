import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import NavMenu from "@/components/NavMenu";
import NotificationBell from "@/components/NotificationBell";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold text-indigo-700">Nexo</span>
            <NavMenu role={session.role} />
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-slate-800">{session.name}</p>
              <p className="text-xs text-slate-500">{ROLE_LABEL[session.role]}</p>
            </div>
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
        className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
      >
        Salir
      </button>
    </form>
  );
}
