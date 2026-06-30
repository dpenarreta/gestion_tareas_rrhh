import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/roles";
import UsersManager from "@/components/UsersManager";

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageUsers(session.role)) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Gestión de usuarios</h1>
        <p className="text-slate-500 mt-1">
          Crear usuarios, resetear contraseñas y administrar roles
        </p>
      </div>
      <UsersManager currentUserRole={session.role} />
    </div>
  );
}
