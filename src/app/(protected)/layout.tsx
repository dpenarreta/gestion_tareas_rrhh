import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";
import { ROLE_LABEL } from "@/lib/roles";
import { logoutAction } from "@/lib/actions";
import { safeLog } from "@/lib/logger";
import AppShell from "@/components/shell/AppShell";
import ConsentGate from "@/components/ConsentGate";
import PasswordChangeGate from "@/components/PasswordChangeGate";

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
  // `must_change_password` viene de `/auth/me/` desde siempre, pero el
  // frontend nunca lo miró. Mientras esté activo, Django responde 403
  // `password_change_required` a TODA ruta salvo cuatro
  // (apps/authentication/authentication.py), así que sin este gate la
  // persona entraba, veía el menú, y cada pantalla aparecía vacía sin
  // explicación ni forma de salir (ver docs/AUDIT_LOG.md § 2026-09-11).
  //
  // Degrada a `false` si no se pudo leer: es el lado correcto acá, al revés
  // que el consentimiento. Bloquear la aplicación entera por no haber
  // podido consultar a Django dejaría a la persona sin salida por un
  // problema de red; y si de verdad hay que cambiar la contraseña, Django
  // lo va a seguir exigiendo en cada petición.
  let mustChangePassword = false;
  if (meResponse?.ok) {
    const me = (await meResponse.json()) as {
      data_consent_accepted: boolean;
      must_change_password: boolean;
    };
    dataConsentAccepted = me.data_consent_accepted;
    mustChangePassword = me.must_change_password;
  } else {
    safeLog(
      "warn",
      "No se pudo leer el consentimiento desde Django: se vuelve a pedir el aviso de tratamiento de datos",
      { djangoRespondio: meResponse !== null, estado: meResponse?.status }
    );
  }

  // El orden importa: primero la contraseña. Con `must_change_password`
  // activo, la llamada que trae el texto del consentimiento también
  // respondería 403, así que pedirlo antes dejaría un modal vacío.
  if (mustChangePassword) {
    return <PasswordChangeGate mustChange onLogout={logoutAction}>{children}</PasswordChangeGate>;
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
