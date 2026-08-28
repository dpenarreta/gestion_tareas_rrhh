import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFlatErrorMessage } from "@/lib/djangoSession";

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoEscritorioDigitalConfig = {
  archive_retention_days: number;
  max_replies: number;
  snooze_presets_minutes: number[];
};

function toNexoShape(data: DjangoEscritorioDigitalConfig) {
  return {
    archiveRetentionDays: data.archive_retention_days,
    maxReplies: data.max_replies,
    snoozePresetsMinutes: data.snooze_presets_minutes,
  };
}

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): `maxReplies` y
// `snoozePresetsMinutes` ya los consume Escritorio Digital (respuestas de
// notas / recordatorios, `apps/desk/services.py`) desde Django — la versión
// anterior de este endpoint los escribía en Postgres, sin ningún efecto sobre
// el feature ya cutover (bug preexistente, no introducido acá).
// `archiveRetentionDays` es distinto: la purga automática de notas archivadas
// (`purgeExpiredArchivedNotes`) es un gap documentado y pospuesto (ver
// docs/ROADMAP.md punto 13) — no existe todavía ni en Django ni activa en
// Next.js (la ruta `desk-notes` cutover dejó de dispararla). Se corta igual
// para que el valor ya viva en el lugar correcto a la espera de esa purga,
// sin efecto práctico hasta entonces.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const response = await djangoApiFetch("/settings/escritorio-digital-config/");
  if (!response || !response.ok) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }

  const data = (await response.json()) as DjangoEscritorioDigitalConfig;
  return NextResponse.json(toNexoShape(data));
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: { archiveRetentionDays?: number; maxReplies?: number; snoozePresetsMinutes?: number[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { archiveRetentionDays, maxReplies, snoozePresetsMinutes } = body;

  if (archiveRetentionDays !== undefined) {
    if (!Number.isInteger(archiveRetentionDays) || archiveRetentionDays < 1 || archiveRetentionDays > 365) {
      return NextResponse.json({ error: "La retención de archivado debe ser un entero entre 1 y 365 días" }, { status: 400 });
    }
  }
  if (maxReplies !== undefined) {
    if (!Number.isInteger(maxReplies) || maxReplies < 1 || maxReplies > 20) {
      return NextResponse.json({ error: "El tope de respuestas debe ser un entero entre 1 y 20" }, { status: 400 });
    }
  }
  if (snoozePresetsMinutes !== undefined) {
    if (
      !Array.isArray(snoozePresetsMinutes) ||
      snoozePresetsMinutes.length === 0 ||
      !snoozePresetsMinutes.every((n) => Number.isInteger(n) && n > 0 && n <= 43200)
    ) {
      return NextResponse.json({ error: "Los presets de posposición deben ser una lista de enteros positivos (máx. 43200 minutos = 30 días)" }, { status: 400 });
    }
  }

  const payload: Record<string, unknown> = {};
  if (archiveRetentionDays !== undefined) payload.archive_retention_days = archiveRetentionDays;
  if (maxReplies !== undefined) payload.max_replies = maxReplies;
  if (snoozePresetsMinutes !== undefined) payload.snooze_presets_minutes = snoozePresetsMinutes;

  const response = await djangoApiFetch("/settings/escritorio-digital-config/", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFlatErrorMessage(response);
    return NextResponse.json({ error: message ?? "Datos inválidos" }, { status: response.status === 403 ? 403 : 400 });
  }

  const data = (await response.json()) as DjangoEscritorioDigitalConfig;
  return NextResponse.json(toNexoShape(data));
}
