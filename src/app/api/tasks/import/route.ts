import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

// Sub-fase 3e de la migración de stack (ver docs/AUDIT_LOG.md §
// 2026-08-07): cortado a Django. Sin gate de rol, igual que el legacy —
// esta ruta solo verifica que haya sesión (401). El `FormData` recibido
// se reenvía tal cual (`djangoSession.ts` ya no fuerza `Content-Type:
// application/json` cuando el body es `FormData`, ver ese archivo).
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

async function extractDjangoErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.error === "string") return data.error;
    if (typeof data?.error?.message === "string") return data.error.message;
  } catch {
    // respuesta sin cuerpo JSON — se usa el mensaje por defecto
  }
  return fallback;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const formData = await request.formData();

  const response = await djangoApiFetch("/tasks/import/", { method: "POST", body: formData });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoErrorMessage(response, "No se pudo importar el archivo");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(await response.json());
}
