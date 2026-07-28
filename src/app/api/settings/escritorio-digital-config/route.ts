import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getEffectiveDeskArchiveRetentionDays,
  setDeskArchiveRetentionDays,
  getEffectiveDeskNoteMaxReplies,
  setDeskNoteMaxReplies,
  getEffectiveSnoozePresetsMinutes,
  setSnoozePresetsMinutes,
} from "@/lib/systemConfig";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [archiveRetentionDays, maxReplies, snoozePresetsMinutes] = await Promise.all([
    getEffectiveDeskArchiveRetentionDays(),
    getEffectiveDeskNoteMaxReplies(),
    getEffectiveSnoozePresetsMinutes(),
  ]);
  return NextResponse.json({ archiveRetentionDays, maxReplies, snoozePresetsMinutes });
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

  await Promise.all([
    archiveRetentionDays !== undefined ? setDeskArchiveRetentionDays(archiveRetentionDays, session.userId) : Promise.resolve(),
    maxReplies !== undefined ? setDeskNoteMaxReplies(maxReplies, session.userId) : Promise.resolve(),
    snoozePresetsMinutes !== undefined ? setSnoozePresetsMinutes(snoozePresetsMinutes, session.userId) : Promise.resolve(),
  ]);

  const [effectiveRetention, effectiveMaxReplies, effectiveSnooze] = await Promise.all([
    getEffectiveDeskArchiveRetentionDays(),
    getEffectiveDeskNoteMaxReplies(),
    getEffectiveSnoozePresetsMinutes(),
  ]);
  return NextResponse.json({
    archiveRetentionDays: effectiveRetention,
    maxReplies: effectiveMaxReplies,
    snoozePresetsMinutes: effectiveSnooze,
  });
}
