import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  CONFIG_KEY_RETENTION_MONTHLY_REPORTS,
  CONFIG_KEY_RETENTION_ARCHIVED_TASKS,
  CONFIG_KEY_RETENTION_KNOWLEDGE_DOCS,
  setConfigValue,
} from "@/lib/systemConfig";
import {
  getEffectivePolicy,
  MONTHLY_REPORTS_OPTIONS,
  ARCHIVED_TASKS_OPTIONS,
  KNOWLEDGE_DOCS_OPTIONS,
} from "@/lib/retentionPolicy";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const policy = await getEffectivePolicy();
  return NextResponse.json(policy);
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

  const { monthlyReportsMonths, archivedTasksMonths, knowledgeDocsMonths } = body;

  if (monthlyReportsMonths !== undefined && !MONTHLY_REPORTS_OPTIONS.includes(monthlyReportsMonths as typeof MONTHLY_REPORTS_OPTIONS[number])) {
    return NextResponse.json({ error: "Retención de informes mensuales inválida" }, { status: 400 });
  }
  if (archivedTasksMonths !== undefined && !ARCHIVED_TASKS_OPTIONS.includes(archivedTasksMonths as typeof ARCHIVED_TASKS_OPTIONS[number])) {
    return NextResponse.json({ error: "Retención de tareas archivadas inválida" }, { status: 400 });
  }
  if (knowledgeDocsMonths !== undefined && !KNOWLEDGE_DOCS_OPTIONS.includes(knowledgeDocsMonths as typeof KNOWLEDGE_DOCS_OPTIONS[number])) {
    return NextResponse.json({ error: "Retención de base de conocimiento inválida" }, { status: 400 });
  }

  await Promise.all([
    monthlyReportsMonths !== undefined
      ? setConfigValue(CONFIG_KEY_RETENTION_MONTHLY_REPORTS, monthlyReportsMonths, session.userId)
      : Promise.resolve(),
    archivedTasksMonths !== undefined
      ? setConfigValue(CONFIG_KEY_RETENTION_ARCHIVED_TASKS, archivedTasksMonths, session.userId)
      : Promise.resolve(),
    knowledgeDocsMonths !== undefined
      ? setConfigValue(CONFIG_KEY_RETENTION_KNOWLEDGE_DOCS, knowledgeDocsMonths, session.userId)
      : Promise.resolve(),
  ]);

  const policy = await getEffectivePolicy();
  return NextResponse.json(policy);
}
