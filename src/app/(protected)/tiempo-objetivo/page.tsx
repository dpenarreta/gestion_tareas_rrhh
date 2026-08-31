import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { fetchDjangoCurrentUserId } from "@/lib/djangoTasksAdapter";
import RegularizeTargetTimeManager from "@/components/tasks/RegularizeTargetTimeManager";

// Bug encontrado en prueba integral en Chrome real (2026-08-31): esta
// página pasaba el cuid de Postgres (`session.userId`) como `currentUserId`,
// pero `RegularizeTargetTimeManager` compara contra `assignedTo.id` de
// tareas ya cortadas a Django (id numérico, Fase 3a) para excluir tareas
// propias de la lista validable y marcar `isSelf`. Mismo fix que
// Tareas/Proyectos/Reuniones/Equipo.
export default async function TargetTimePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMINISTRADOR" && session.role !== "JEFE_NACIONAL") redirect("/dashboard");

  const djangoUserId = await fetchDjangoCurrentUserId();

  return (
    <div className="space-y-6">
      <p className="text-secondary">
        Tiempo Objetivo — el líder valida integralmente la planificación de sus subordinados (Tiempo Objetivo y Fecha
        Fin, cada uno de forma independiente) desde una sola pantalla. Nunca modifica horas reales ni recalcula
        automáticamente; la decisión siempre es humana.
      </p>
      <RegularizeTargetTimeManager currentUserId={djangoUserId ?? session.userId} />
    </div>
  );
}
