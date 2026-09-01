import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canViewRoles, canManageRoles } from "@/lib/permissions";
import RolesPermissionsManager from "@/components/RolesPermissionsManager";

export default async function AdminRolesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canViewRoles(session.permissions)) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <p className="text-secondary">
        Gestión de roles y asignación de permisos por módulo.
      </p>
      <RolesPermissionsManager
        canEdit={canManageRoles(session.permissions)}
        currentSessionRole={session.role}
      />
    </div>
  );
}
