import { getSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">
        Bienvenido, {session.name}
      </h1>
    </div>
  );
}
