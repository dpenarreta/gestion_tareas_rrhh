import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import SettingsManager from "@/components/SettingsManager";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMINISTRADOR") redirect("/dashboard");

  return (
    <div className="space-y-6">
      <p className="text-secondary">
        Consentimiento de datos, gestión de contraseñas e información del sistema
      </p>
      <SettingsManager />
    </div>
  );
}
