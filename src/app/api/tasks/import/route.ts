import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { TaskPriority, TaskFrequency } from "@/generated/prisma/client";

const VALID_PRIORITIES = ["ALTA", "MEDIA", "BAJA"];
const VALID_FREQUENCIES = ["MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL", "PUNTUAL"];

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const str = String(value).trim();
  const parts = str.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
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
    const [title, description, priority, frequency, startDateRaw, endDateRaw, estimatedHoursRaw, assignedEmail] =
      dataRows[i] as string[];

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

    const startDate = parseDate(startDateRaw);
    if (!startDate) {
      errors.push({ row: rowNum, error: `Fecha inicio inválida: "${startDateRaw}". Use formato DD/MM/YYYY` });
      continue;
    }

    const endDate = parseDate(endDateRaw);
    if (!endDate) {
      errors.push({ row: rowNum, error: `Fecha fin inválida: "${endDateRaw}". Use formato DD/MM/YYYY` });
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
        },
      });
      imported++;
    } catch {
      errors.push({ row: rowNum, error: "Error al crear la tarea" });
    }
  }

  return NextResponse.json({ imported, errors });
}
