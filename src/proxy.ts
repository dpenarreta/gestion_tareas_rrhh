import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_SECRET } from "@/lib/session-secret";
import { requireHttps } from "@/lib/httpsPolicy";
import {
  DJANGO_ACCESS_COOKIE,
  DJANGO_ACCESS_MAX_AGE_SECONDS,
  DJANGO_REFRESH_COOKIE,
  DJANGO_REFRESH_MAX_AGE_SECONDS,
  djangoCookieOptions,
} from "@/lib/djangoTokenCookies";

const secret = new TextEncoder().encode(SESSION_SECRET);

const DJANGO_API_URL = process.env.DJANGO_API_URL || "http://localhost:8000/api/v1";

// Más corto que el timeout general de la aplicación: esto corre en el camino
// de CADA navegación, así que un Django lento no puede quedarse con la
// carga de la página. Si no llega a tiempo, se sigue sin tokens nuevos.
const REFRESH_TIMEOUT_MS = 2500;

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/forgot-password",
  // Fase 6c (ver docs/AUDIT_LOG.md § 2026-08-17): pantalla de confirmación
  // del reset de contraseña — el link del email apunta acá sin sesión.
  "/reset-password",
  "/api/auth/reset-password",
];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Defensa adicional contra CSRF/cross-origin: para métodos que mutan estado en
// la API, exige que el Origin (cuando el navegador lo envía) coincida con el
// propio host. No sustituye a SameSite=strict en la cookie de sesión, la
// complementa.
function hasValidOrigin(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true; // clientes no-navegador (curl, server-to-server) no envían Origin
  try {
    const originHost = new URL(origin).host;
    // Detrás de un reverse proxy (IIS + ARR), el Host que llega a Next.js es
    // el del destino (127.0.0.1:3080), no el que usó el navegador
    // (10.0.2.33:4080): ARR solo preserva el original si se activa
    // `preserveHostHeader`, que es una opción GLOBAL del servidor de IIS — y
    // el servidor de este despliegue aloja además otros sistemas de la
    // empresa, así que no se toca. Por eso se acepta también el host que el
    // proxy reenvía en X-Forwarded-Host (lo fija `web.config`); sin esto,
    // toda ruta /api/ responde 403 detrás del proxy, incluido el login.
    // Falsificar esa cabecera exigiría llegar al puerto de Next.js, que solo
    // escucha en loopback, y la defensa real contra CSRF sigue siendo
    // `sameSite: "strict"` en la cookie de sesión (src/lib/session.ts).
    const forwardedHost = request.headers.get("x-forwarded-host");
    return originHost === request.nextUrl.host || originHost === forwardedHost;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    process.env.NODE_ENV === "production" &&
    requireHttps &&
    request.headers.get("x-forwarded-proto") === "http"
  ) {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = "https:";
    return NextResponse.redirect(httpsUrl, 308);
  }

  if (pathname.startsWith("/api/") && !hasValidOrigin(request)) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (isPublic) {
    const token = request.cookies.get("nexo-session")?.value;
    if (token) {
      try {
        await jwtVerify(token, secret, { algorithms: ["HS256"] });
        return NextResponse.redirect(new URL("/dashboard", request.url));
      } catch {
        // Invalid token, continue to public route
      }
    }
    return NextResponse.next();
  }

  const token = request.cookies.get("nexo-session")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return await withRefreshedDjangoTokens(request);
  } catch {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("nexo-session");
    return response;
  }
}

/**
 * Renueva los tokens de Django cuando el access ya expiró, ANTES de que se
 * rendericen los Server Components.
 *
 * Acá y no en `djangoApiFetch` porque el middleware es el único punto del
 * camino de una página que puede **escribir cookies**: durante el render de
 * un Server Component, Next.js no lo permite. Y guardar el resultado no es
 * opcional: Django rota el refresh token en cada refresco e invalida el
 * anterior, así que refrescar sin poder persistirlo revoca la sesión en la
 * petición siguiente (ver docs/AUDIT_LOG.md § 2026-09-11).
 *
 * Sin esto, cada carga de página con el access vencido dejaba al layout sin
 * sesión Django, y el aviso de tratamiento de datos reaparecía aunque la
 * persona ya lo hubiera aceptado.
 */
async function withRefreshedDjangoTokens(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next();

  // Solo cuando el access ya no está y todavía queda refresh: mientras el
  // access siga vivo no se toca nada, así que esto no agrega una llamada a
  // Django en cada request.
  const accessToken = request.cookies.get(DJANGO_ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(DJANGO_REFRESH_COOKIE)?.value;
  if (accessToken || !refreshToken) return response;

  // Las peticiones a `/api/` las atiende una Route Handler, que sí puede
  // escribir cookies y ya refresca por su cuenta: hacerlo también acá
  // consumiría la rotación dos veces para la misma navegación.
  if (request.nextUrl.pathname.startsWith("/api/")) return response;

  try {
    const djangoResponse = await fetch(`${DJANGO_API_URL}/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!djangoResponse.ok) return response;

    const data = (await djangoResponse.json()) as { access: string; refresh?: string };
    response.cookies.set(
      DJANGO_ACCESS_COOKIE,
      data.access,
      djangoCookieOptions(DJANGO_ACCESS_MAX_AGE_SECONDS)
    );
    if (data.refresh) {
      response.cookies.set(
        DJANGO_REFRESH_COOKIE,
        data.refresh,
        djangoCookieOptions(DJANGO_REFRESH_MAX_AGE_SECONDS)
      );
    }
  } catch {
    // Django caído o lento: se sigue sin tokens nuevos. La página se
    // renderiza igual y cada consumidor degrada como ya sabe hacerlo —
    // bloquear la navegación entera por esto sería peor.
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
