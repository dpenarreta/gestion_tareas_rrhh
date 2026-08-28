import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { extractDjangoFlatErrorMessage } from "@/lib/djangoSession";
import { fetchRetentionPolicy, toRetentionPolicy, updateRetentionPolicy } from "@/lib/djangoRetentionAdapter";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

// Cutover de stack — Fase 83 (ver docs/AUDIT_LOG.md § 2026-08-27): réplica
// de `RetentionPolicyView` (backend, Fase 31, completo). El bloqueo original
// (la purga real requería `MonthlyReport`/`DataPurgeLog`, sin portar) ya no
// aplica — se cierra junto con `retention-policy/purge/route.ts` en el mismo
// cambio.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await fetchRetentionPolicy();
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = await response.json();
  return NextResponse.json(toRetentionPolicy(data));
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { monthlyReportsMonths?: string; archivedTasksMonths?: string; knowledgeDocsMonths?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const response = await updateRetentionPolicy(body);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Retención inválida" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = await response.json();
  return NextResponse.json(toRetentionPolicy(data));
}
