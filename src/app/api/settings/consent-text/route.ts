import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Pedido explícito del usuario (ver docs/AUDIT_LOG.md § 2026-09-02,
// "Consentimiento de datos editable desde Ajustes"): el aviso de
// "Tratamiento de Datos Personales" (`ConsentGate.tsx`) pasa de estar
// hardcodeado en JSX a ser Markdown editable. `GET` sin restricción de rol
// a propósito — lo necesita CUALQUIER usuario recién logueado, antes de
// aceptar el consentimiento, no solo Administrador (mismo criterio que
// `welcome-message/route.ts`).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/consent-text/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = (await response.json()) as { text: string };
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

  const { text } = body as { text?: string };
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "El texto no puede quedar vacío" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/consent-text/", {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const errMessage = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: errMessage ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = (await response.json()) as { text: string };
  return NextResponse.json(data);
}
