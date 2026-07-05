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
      <p className="text-secondary">
        Crear usuarios, resetear contraseñas y administrar roles
      </p>
      <UsersManager currentUserRole={session.role} />
    </div>
  );
}
