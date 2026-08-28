import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoDataRequestToNexoShape, type DjangoDataSubjectRequest } from "@/lib/djangoDataRequestsAdapter";

type Ctx = { params: Promise<{ id: string }> };

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): esta ruta pasó de
// Prisma a Django.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/data-requests/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ status: body.status }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const updated: DjangoDataSubjectRequest = await response.json();
  return NextResponse.json(mapDjangoDataRequestToNexoShape(updated));
}
