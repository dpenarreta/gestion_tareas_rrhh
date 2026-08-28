import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoDataRequestToNexoShape, type DjangoDataSubjectRequest } from "@/lib/djangoDataRequestsAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): esta ruta pasó de
// Prisma a Django. La visibilidad (todas si es Administrador, solo propias
// si no) y la notificación a administradores (rectificación/eliminación)
// ya viven en `apps.data_requests.services`.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/data-requests/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const requests: DjangoDataSubjectRequest[] = await response.json();
  return NextResponse.json(requests.map(mapDjangoDataRequestToNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { type?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const response = await djangoApiFetch("/data-requests/", {
    method: "POST",
    body: JSON.stringify({ type: body.type, description: body.description }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Tipo de solicitud inválido" }, { status: 400 });
  }

  const created: DjangoDataSubjectRequest = await response.json();
  return NextResponse.json(mapDjangoDataRequestToNexoShape(created), { status: 201 });
}
