import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoLeaveRecord = {
  id: number;
  userId: number;
  user: { id: number; name: string };
  type: string;
  date: string;
  isFullDay: boolean;
  durationMinutes: number | null;
  observation: string | null;
};

function toNexoShape(r: DjangoLeaveRecord) {
  return { ...r, id: String(r.id), userId: String(r.userId), user: { ...r.user, id: String(r.user.id) } };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): réplica de
// `LeaveRecordListView` (backend, Fase 29, completo) — mismas claves
// camelCase que el contrato TS en la respuesta (`_serialize_leave_record`),
// solo se convierten los ids numéricos a `string`. **Cierra un bug activo
// preexistente:** `users` (prop de `LeaveRecordsSection.tsx`) viene de
// `GET /api/users` (Django, id numérico desde la Fase 2) — el `userId`
// enviado en el `POST` ya no coincidía con ningún `cuid` de Postgres desde
// entonces, así que crear un permiso para cualquier usuario devolvía 404
// "Usuario no encontrado" en la práctica.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const userId = request.nextUrl.searchParams.get("userId");
  const month = request.nextUrl.searchParams.get("month");
  const query = new URLSearchParams();
  if (userId) query.set("user_id", userId);
  if (month) query.set("month", month);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const response = await djangoApiFetch(`/settings/leave-records/${suffix}`);
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (response.status === 403) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Error al obtener los permisos" }, { status: response.status });
  }

  const data = (await response.json()) as DjangoLeaveRecord[];
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

  const { userId, type, startDate, endDate, isFullDay, durationMinutes, observation } = body as {
    userId?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
    isFullDay?: boolean;
    durationMinutes?: number;
    observation?: string;
  };

  if (!userId || !startDate || !endDate || typeof isFullDay !== "boolean") {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const response = await djangoApiFetch("/settings/leave-records/", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      type,
      start_date: startDate,
      end_date: endDate,
      is_full_day: isFullDay,
      duration_minutes: durationMinutes,
      observation,
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

  const data = (await response.json()) as { records: DjangoLeaveRecord[]; businessDaysCount: number };
  return NextResponse.json({ records: data.records.map(toNexoShape), businessDaysCount: data.businessDaysCount }, { status: 201 });
}
