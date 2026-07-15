import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import SettingsManager from "@/components/SettingsManager";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMINISTRADOR" && session.role !== "COORDINADOR_NACIONAL") redirect("/dashboard");

  return (
    <div className="space-y-6">
      <p className="text-secondary">
        Consentimiento de datos, gestión de contraseñas, carga laboral, solicitudes de titulares,
        política de retención y base de conocimiento RRHH
      </p>
      <SettingsManager currentUserRole={session.role} />
    </div>
  );
}
