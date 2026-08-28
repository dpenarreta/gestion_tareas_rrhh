import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveDjangoUserId } from "@/lib/djangoSession";
import PreventiveIntelligenceModule from "@/components/inteligencia-preventiva/PreventiveIntelligenceModule";

// `/api/predictive/**` (Fase 48, ver docs/AUDIT_LOG.md § 2026-08-24) espera
// el id numérico de Django, no el `cuid` de Postgres — mismo puente de la
// Fase 40 ya usado por Notificaciones/Reuniones/Ideas/Equipo.
export default async function InteligenciaPreventivaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const djangoUserId = await resolveDjangoUserId(session);

  return (
    <PreventiveIntelligenceModule
      currentUserId={djangoUserId !== null ? String(djangoUserId) : ""}
      currentUserRole={session.role}
      currentUserName={session.name}
    />
  );
}
