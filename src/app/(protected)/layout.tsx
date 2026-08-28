import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";
import { ROLE_LABEL } from "@/lib/roles";
import { logoutAction } from "@/lib/actions";
import AppShell from "@/components/shell/AppShell";
import ConsentGate from "@/components/ConsentGate";

// Cutover de stack — Fase 86 (ver docs/AUDIT_LOG.md § 2026-08-28): réplica
// de `GET /auth/me/` (`UserPublicSerializer`, ahora con
// `data_consent_accepted` agregado en esta misma fase). Llamada
// INDEPENDIENTE de `resolveDjangoUserId` a propósito: su fast-path evita
// tocar Django si `session.djangoUserId` ya está cacheado, pero el
// consentimiento necesita dato SIEMPRE fresco, nunca cacheado en el JWT.
// Sin sesión Django disponible, degrada a `false` (mismo criterio que el
// resto de esta migración — nunca bloquea la página).
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [meResponse, djangoUserId] = await Promise.all([djangoApiFetch("/auth/me/"), resolveDjangoUserId(session)]);
  const dataConsentAccepted = meResponse?.ok
    ? ((await meResponse.json()) as { data_consent_accepted: boolean }).data_consent_accepted
    : false;

  return (
    <ConsentGate initialAccepted={dataConsentAccepted}>
      <AppShell
        role={session.role}
        userId={session.userId}
        // Fase 40 (ver docs/AUDIT_LOG.md § 2026-08-21): `NotificationBell`
        // compara `taskAssignedToId` (id numérico de Django, Tareas ya
        // cutover) contra el id del usuario en sesión — necesita el id de
        // Django, no el `cuid` de Postgres que sigue usando `ThemeToggle`.
        // `""` si no se pudo resolver: la comparación simplemente nunca da
        // "es mía", degradado sin romper la página.
        djangoUserId={djangoUserId !== null ? String(djangoUserId) : ""}
        userName={session.name}
        roleLabel={ROLE_LABEL[session.role]}
        onLogout={logoutAction}
      >
        {children}
      </AppShell>
    </ConsentGate>
  );
}
