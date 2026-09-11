import { requireHttps } from "@/lib/httpsPolicy";

/**
 * Nombres y opciones de las cookies con los tokens de Django.
 *
 * Vive aparte de `djangoSession.ts` porque ese módulo es `server-only` y
 * **el middleware (`src/proxy.ts`) no puede importarlo**. El middleware es
 * justamente donde hay que refrescar los tokens: corre antes de que se
 * rendericen los Server Components y, a diferencia de ellos, sí puede
 * escribir cookies en la respuesta (ver docs/AUDIT_LOG.md § 2026-09-11).
 *
 * Tener un solo lugar con estos valores evita que el middleware y
 * `djangoSession.ts` escriban la misma cookie con atributos distintos, que
 * el navegador trataría como dos cookies diferentes.
 */

export const DJANGO_ACCESS_COOKIE = "nexo-django-access";
export const DJANGO_REFRESH_COOKIE = "nexo-django-refresh";

// Deben coincidir con JWT_ACCESS_TOKEN_LIFETIME_MINUTES /
// JWT_REFRESH_TOKEN_LIFETIME_DAYS de backend/.env — la cookie no debe
// sobrevivir más que el token que contiene.
export const DJANGO_ACCESS_MAX_AGE_SECONDS = 15 * 60;
export const DJANGO_REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function djangoCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // Mismo criterio que la cookie de sesión de Next.js: sin HTTPS el cliente
    // no devuelve una cookie `secure`, y sin estos tokens toda llamada a
    // Django en nombre del usuario falla con "Tu sesión no tiene aún acceso a
    // este módulo" — verificado en el despliegue real (ver httpsPolicy.ts).
    secure: process.env.NODE_ENV === "production" && requireHttps,
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
