import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { invalidateAnalyticsCache } from "@/lib/analytics";
import type { TaskPriority, TaskFrequency, TaskType } from "@/generated/prisma/client";

const VALID_PRIORITIES = ["ALTA", "MEDIA", "BAJA"];
const VALID_FREQUENCIES = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL", "PUNTUAL"];
const VALID_TYPES = ["FIJA", "SEGUIMIENTO"];

// Task.startDate/endDate are stored as UTC-midnight calendar days (see project
// convention); always build parsed dates with Date.UTC, never the local Date
// constructor, or the stored day silently shifts depending on server timezone.
function isValidUTCDate(y: number, month: number, day: number): boolean {
  if (![y, month, day].every(Number.isInteger)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(y, month - 1, day));
  return date.getUTCFullYear() === y && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Excel serial date numbers count days since 1899-12-30; this offset converts
// to a Unix-epoch UTC timestamp.
function excelSerialToUTCDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return isNaN(date.getTime()) ? null : date;
}

function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return excelSerialToUTCDate(value);
  }

  const str = String(value).trim();
  if (!str) return null;

  // YYYY-MM-DD (primary format)
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    return isValidUTCDate(y, mo, d) ? new Date(Date.UTC(y, mo - 1, d)) : null;
  }

  // DD/MM/YYYY or MM/DD/YYYY — ambiguous, try DD/MM first then fall back to MM/DD
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    if (isValidUTCDate(y, b, a)) return new Date(Date.UTC(y, b - 1, a));
    if (isValidUTCDate(y, a, b)) return new Date(Date.UTC(y, a - 1, b));
    return null;
  }

  return null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No se envió ningún archivo" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];

  const dataRows = rows.slice(1).filter((r) => r.some((c) => c != null && c !== ""));

  let imported = 0;
  const errors: { row: number; error: string }[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2;
    const [title, description, priority, frequency, startDateRaw, endDateRaw, estimatedHoursRaw, assignedEmail, typeRaw] =
      dataRows[i] as string[];

    const typeNorm = String(typeRaw ?? "").trim().toUpperCase();
    const taskType: TaskType = VALID_TYPES.includes(typeNorm) ? (typeNorm as TaskType) : "FIJA";

    if (!title?.trim()) {
      errors.push({ row: rowNum, error: "Título requerido" });
      continue;
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      errors.push({ row: rowNum, error: `Prioridad inválida: "${priority}". Use ALTA, MEDIA o BAJA` });
      continue;
    }
    if (!VALID_FREQUENCIES.includes(frequency)) {
      errors.push({ row: rowNum, error: `Frecuencia inválida: "${frequency}". Use MENSUAL, SEMANAL, DIARIA, QUINCENAL o PUNTUAL` });
      continue;
    }

    if (startDateRaw === undefined || startDateRaw === null || String(startDateRaw).trim() === "") {
      errors.push({ row: rowNum, error: "la fecha de inicio es obligatoria" });
      continue;
    }
    const startDate = parseDate(startDateRaw);
    if (!startDate) {
      errors.push({ row: rowNum, error: "formato de fecha inválido, usar YYYY-MM-DD" });
      continue;
    }

    if (endDateRaw === undefined || endDateRaw === null || String(endDateRaw).trim() === "") {
      errors.push({ row: rowNum, error: "la fecha de fin es obligatoria" });
      continue;
    }
    const endDate = parseDate(endDateRaw);
    if (!endDate) {
      errors.push({ row: rowNum, error: "formato de fecha inválido, usar YYYY-MM-DD" });
      continue;
    }

    const estimatedHours = parseFloat(String(estimatedHoursRaw));
    if (isNaN(estimatedHours)) {
      errors.push({ row: rowNum, error: "Horas estimadas inválidas" });
      continue;
    }

    let assignedToId = session.userId;
    if (assignedEmail?.trim()) {
      const user = await prisma.user.findUnique({ where: { email: assignedEmail.trim() } });
      if (user) assignedToId = user.id;
      else {
        errors.push({ row: rowNum, error: `Usuario no encontrado: "${assignedEmail}"` });
        continue;
      }
    }

    try {
      await prisma.task.create({
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          priority: priority as TaskPriority,
          frequency: frequency as TaskFrequency,
          startDate,
          endDate,
          estimatedHours,
          assignedToId,
          createdById: session.userId,
          type: taskType,
        },
      });
      imported++;
    } catch {
      errors.push({ row: rowNum, error: "Error al crear la tarea" });
    }
  }

  if (imported > 0) {
    invalidateAnalyticsCache();
  }

  return NextResponse.json({ imported, errors });
}
