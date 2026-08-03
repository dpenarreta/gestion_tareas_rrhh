import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import RegularizeTargetTimeManager from "@/components/tasks/RegularizeTargetTimeManager";

export default async function TargetTimePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMINISTRADOR" && session.role !== "JEFE_NACIONAL") redirect("/dashboard");

  return (
    <div className="space-y-6">
      <p className="text-secondary">
        Tiempo Objetivo — el líder valida integralmente la planificación de sus subordinados (Tiempo Objetivo y Fecha
        Fin, cada uno de forma independiente) desde una sola pantalla. Nunca modifica horas reales ni recalcula
        automáticamente; la decisión siempre es humana.
      </p>
      <RegularizeTargetTimeManager currentUserId={session.userId} />
    </div>
  );
}
