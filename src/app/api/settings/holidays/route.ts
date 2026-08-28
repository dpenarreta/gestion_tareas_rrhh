import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoHoliday = { id: number; date: string; name: string; year: number };

function toNexoShape(h: DjangoHoliday) {
  return { ...h, id: String(h.id) };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `HolidayListView` (backend, Fase 29, completo) — mismas claves camelCase
// que el contrato TS, solo se convierte `id` a `string`.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const year = request.nextUrl.searchParams.get("year");
  const query = year ? `?year=${encodeURIComponent(year)}` : "";

  const response = await djangoApiFetch(`/settings/holidays/${query}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener los feriados" }, { status: response.status });
  }

  const data = (await response.json()) as DjangoHoliday[];
  return NextResponse.json(data.map(toNexoShape));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 });
  }

  const { date, name } = body as { date?: string; name?: string };
  if (!date || !name?.trim()) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/holidays/", {
    method: "POST",
    body: JSON.stringify({ date, name: name.trim() }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: response.status === 409 ? 409 : 400 });
  }

  const data = (await response.json()) as DjangoHoliday;
  return NextResponse.json(toNexoShape(data), { status: 201 });
}
