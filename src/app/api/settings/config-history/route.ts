import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoConfigHistoryRow = {
  key: string;
  value: string;
  valid_from: string;
  valid_until: string | null;
  updated_by_name: string;
};

function toNexoShape(r: DjangoConfigHistoryRow) {
  return { key: r.key, value: r.value, validFrom: r.valid_from, validUntil: r.valid_until, updatedByName: r.updated_by_name };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `ConfigHistoryView` (backend, Fase 33, completo).
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const keysParam = request.nextUrl.searchParams.get("keys");
  const keys = (keysParam ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    return NextResponse.json({ error: "keys es requerido" }, { status: 400 });
  }

  const response = await djangoApiFetch(`/settings/config-history/?keys=${encodeURIComponent(keys.join(","))}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener el historial" }, { status: response.status });
  }

  const data = (await response.json()) as DjangoConfigHistoryRow[];
  return NextResponse.json(data.map(toNexoShape));
}
