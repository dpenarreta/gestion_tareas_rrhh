import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";
import { ROLE_LABEL } from "@/lib/roles";
import { logoutAction } from "@/lib/actions";
import { safeLog } from "@/lib/logger";
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

  // Degradar a `false` significa volver a pedir el consentimiento, así que
  // hay que saber cuándo pasa: para quien ya aceptó es indistinguible de
  // "el sistema se olvidó de lo que acepté". Ocurrió de verdad (ver
  // docs/AUDIT_LOG.md § 2026-09-11) y fue difícil de rastrear justamente
  // porque este camino era silencioso. Se conserva el `false` —es el lado
  // conservador desde cumplimiento— pero deja de ser invisible.
  let dataConsentAccepted = false;
  if (meResponse?.ok) {
    dataConsentAccepted = ((await meResponse.json()) as { data_consent_accepted: boolean })
      .data_consent_accepted;
  } else {
    safeLog(
      "warn",
      "No se pudo leer el consentimiento desde Django: se vuelve a pedir el aviso de tratamiento de datos",
      { djangoRespondio: meResponse !== null, estado: meResponse?.status }
    );
  }

  return (
    <ConsentGate initialAccepted={dataConsentAccepted}>
      <AppShell
        role={session.role}
        // `""` si no se pudo resolver: la comparación de `NotificationBell`
        // simplemente nunca da "es mía", degradado sin romper la página.
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
