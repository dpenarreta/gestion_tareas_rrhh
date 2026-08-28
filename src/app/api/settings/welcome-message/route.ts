import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): forma parte de la
// Fase 51 (cutover de `GET /api/dashboard`) — el Dashboard ya lee este
// mensaje de Django (`build_dashboard_payload`), así que dejar esta ruta en
// Prisma habría introducido una divergencia nueva (Ajustes escribiendo en
// Postgres, Dashboard leyendo de SQL Server). Se cortan juntas en el mismo
// cambio para no introducir staleness, mismo criterio que la Fase 38.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/welcome-message/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = (await response.json()) as { message: string; active: boolean };
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { message, active } = body as { message?: string; active?: boolean };
  if (typeof message !== "string" || typeof active !== "boolean") {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/welcome-message/", {
    method: "PUT",
    body: JSON.stringify({ message, active }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const errMessage = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: errMessage ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = (await response.json()) as { message: string; active: boolean };
  return NextResponse.json(data);
}
