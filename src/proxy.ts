import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_SECRET } from "@/lib/session-secret";

const secret = new TextEncoder().encode(SESSION_SECRET);

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/forgot-password"];
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
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    process.env.NODE_ENV === "production" &&
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
    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("nexo-session");
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
