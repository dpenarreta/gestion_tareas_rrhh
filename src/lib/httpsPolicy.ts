// Política de HTTPS del despliegue — fuente de verdad única para las tres
// piezas que dependen de ella (`src/proxy.ts`, `src/lib/session.ts` y el
// header HSTS de `next.config.ts`), y equivalente al `REQUIRE_HTTPS` que lee
// `backend/config/settings/production.py`.
//
// Por qué existe: hasta v1.150.9 el modo producción exigía HTTPS sin forma de
// desactivarlo — `proxy.ts` redirigía a `https://`, la cookie de sesión salía
// con `secure: true` y Django forzaba `SESSION_COOKIE_SECURE`. Servido por
// `http://` a secas eso no falla con un error claro: el navegador
// simplemente no manda la cookie de sesión y el login queda en un bucle de
// redirección. El despliegue de este sistema es en una red interna, por IP y
// sin TLS (decisión explícita del usuario, 2026-09-08), así que hacía falta
// poder relajarlo — sin que dejar de poner la variable relaje nada.
//
// Seguro por defecto: solo un `REQUIRE_HTTPS=false` explícito lo desactiva.
// Cualquier otro valor (o su ausencia) mantiene la exigencia de HTTPS.
//
// El costo de desactivarlo, para que quede escrito: sin TLS, las
// credenciales del login y la cookie de sesión viajan en claro por la red, y
// cualquiera con acceso al tráfico del segmento puede leerlas o robar la
// sesión. Es aceptable solo en una red interna controlada, y deja de serlo
// el día que el sistema se publique fuera de ella.
export const requireHttps = process.env.REQUIRE_HTTPS !== "false";
