import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoSpecialStatus = {
  id: number;
  userId: number;
  user: { id: number; name: string };
  type: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  dailyHours: number;
  limitLow: number;
  limitBase: number;
  limitHigh: number;
  limitOverload: number;
};

function toNexoShape(r: DjangoSpecialStatus) {
  return { ...r, id: String(r.id), userId: String(r.userId), user: { ...r.user, id: String(r.user.id) } };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `SpecialStatusListView` (backend, Fase 29, completo) — mismas claves
// camelCase que el contrato TS en la respuesta (`_serialize_special_status`),
// solo se convierten los ids numéricos a `string`. Mismo bug activo
// preexistente que `leave-records` (id de `GET /api/users` ya numérico
// desde la Fase 2, nunca coincidía con el `cuid` que Postgres esperaba).
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const userId = request.nextUrl.searchParams.get("userId");
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";

  const response = await djangoApiFetch(`/settings/special-status/${query}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener los estados especiales" }, { status: response.status });
  }

  const data = (await response.json()) as DjangoSpecialStatus[];
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

  const { userId, type, startDate, endDate, dailyHours, limitLow, limitBase, limitHigh, limitOverload } = body as {
    userId?: string;
    type?: string;
    startDate?: string;
    endDate?: string | null;
    dailyHours?: number;
    limitLow?: number;
    limitBase?: number;
    limitHigh?: number;
    limitOverload?: number;
  };

  if (!userId || !startDate || (type !== "MATERNIDAD" && type !== "LACTANCIA")) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/special-status/", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      type,
      start_date: startDate,
      end_date: endDate ?? null,
      daily_hours: dailyHours,
      limit_low: limitLow,
      limit_base: limitBase,
      limit_high: limitHigh,
      limit_overload: limitOverload,
    }),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 404) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: 400 });
  }

  const data = (await response.json()) as DjangoSpecialStatus;
  return NextResponse.json(toNexoShape(data), { status: 201 });
}
