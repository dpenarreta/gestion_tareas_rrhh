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
        Regularización de Tiempo Objetivo (§Sprint 6) — valida el estándar operativo de tareas activas o
        recientes que aún no tienen un Tiempo Objetivo validado. Nunca modifica horas reales ni recalcula
        automáticamente desde el historial; la decisión siempre es humana.
      </p>
      <RegularizeTargetTimeManager currentUserId={session.userId} />
    </div>
  );
}
