import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { ROLE_LABEL, getSubordinateRoles, canViewTeam } from "@/lib/roles";
import { getEmbedding, cosineSimilarity } from "@/lib/embeddings";
import type { Role } from "@/generated/prisma/client";

type Mode = "general" | "tasks" | "hr";
type HistoryMessage = { role: "user" | "assistant"; content: string };

const STATUS_LABEL: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En Progreso",
  COMPLETADA: "Completada",
};

function fmt(d: Date | string) {
  return new Date(d).toLocaleDateString("es-CL");
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const SYSTEM_HR = `Eres un consultor experto en recursos humanos que analiza datos reales de un equipo de trabajo para Nexo.

REGLAS ESTRICTAS:
1. Análisis objetivo y basado únicamente en los datos proporcionados.
2. Nunca complaciente — si hay problemas, nómbralos con claridad.
3. Recomendaciones concretas y accionables con responsable o área específica.
4. Lenguaje profesional y directo. Sin rodeos ni eufemismos.
5. Si usas información de los documentos base, cita la fuente al final del párrafo relevante con el formato exacto: (Fuente: Nombre del documento, pág. N)
6. Si la pregunta no tiene relación con los documentos disponibles, responde con tu conocimiento general de RRHH e indica: "No encontré información específica sobre esto en los documentos disponibles."
7. Responde siempre en español.`;

const SYSTEM_TASKS = `Eres un asistente especializado en gestión de tareas para Nexo.
Analizas las tareas del usuario y das recomendaciones concretas de priorización, gestión del tiempo y productividad.
Responde en español, sé directo y accionable.`;

const SYSTEM_GENERAL = `Eres un asistente de propósito general para Nexo, un sistema interno de gestión de recursos humanos.
Responde de manera profesional, clara y concisa en español.`;

async function buildTaskContext(userId: string): Promise<string> {
  const today = new Date();
  const tasks = await prisma.task.findMany({
    where: { assignedToId: userId },
    select: {
      title: true, status: true, priority: true, type: true,
      startDate: true, endDate: true,
      estimatedHours: true, realHours: true, progress: true,
    },
    orderBy: [{ status: "asc" }, { endDate: "asc" }],
  });

  if (tasks.length === 0) return "El usuario no tiene tareas asignadas actualmente.";

  const overdue = tasks.filter(
    (t) => t.status !== "COMPLETADA" && new Date(t.endDate) < today
  ).length;

  const lines = tasks.map((t) => {
    const vencida = t.status !== "COMPLETADA" && new Date(t.endDate) < today;
    return `- [${STATUS_LABEL[t.status]}] "${t.title}"
  Prioridad: ${t.priority} | Tipo: ${t.type} | Avance: ${t.progress}%
  Fechas: ${fmt(t.startDate)} → ${fmt(t.endDate)}${vencida ? " ⚠️ VENCIDA" : ""}
  Horas: ${round2(t.estimatedHours)}h estimadas / ${round2(t.realHours)}h reales`;
  });

  return `TAREAS DEL USUARIO (fecha actual: ${fmt(today)}):
Total: ${tasks.length} | Vencidas: ${overdue}
Completadas: ${tasks.filter((t) => t.status === "COMPLETADA").length} | En progreso: ${tasks.filter((t) => t.status === "EN_PROGRESO").length} | Pendientes: ${tasks.filter((t) => t.status === "PENDIENTE").length}

${lines.join("\n\n")}`;
}

async function buildTeamContext(userId: string, userRole: Role): Promise<string> {
  if (!canViewTeam(userRole)) return "";

  const subordinateRoles = getSubordinateRoles(userRole);
  if (subordinateRoles.length === 0) return "No hay subordinados asignados.";

  const today = new Date();
  const members = await prisma.user.findMany({
    where: { role: { in: subordinateRoles } },
    select: {
      name: true, role: true,
      assignedTasks: {
        select: {
          status: true, priority: true,
          estimatedHours: true, realHours: true,
          endDate: true, progress: true,
        },
      },
    },
  });

  const memberLines = members.map((m) => {
    const tasks = m.assignedTasks;
    const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
    const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO").length;
    const overdue = tasks.filter(
      (t) => t.status !== "COMPLETADA" && new Date(t.endDate) < today
    ).length;
    const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
    const estH = round2(tasks.reduce((s, t) => s + t.estimatedHours, 0));
    const realH = round2(tasks.reduce((s, t) => s + t.realHours, 0));
    const carga = estH > 0 ? Math.round((realH / estH) * 100) : 0;
    const avgProg =
      inProgress > 0
        ? Math.round(
            tasks.filter((t) => t.status === "EN_PROGRESO").reduce((s, t) => s + t.progress, 0) / inProgress
          )
        : 0;

    return `${m.name} (${ROLE_LABEL[m.role]}):
  Tareas: ${tasks.length} total | ${completed} completadas (${pct}%) | ${inProgress} en curso | ${overdue} vencidas
  Horas: ${estH}h estimadas / ${realH}h reales → Carga: ${carga}%${inProgress > 0 ? ` | Avance prom. en curso: ${avgProg}%` : ""}`;
  });

  return `EQUIPO A CARGO (rol del usuario: ${ROLE_LABEL[userRole]}):
${memberLines.join("\n\n")}`;
}

type RelevantChunk = {
  content: string;
  pageNumber: number;
  score: number;
  docTitle: string;
  docFileName: string;
};

async function findRelevantChunks(question: string, topK = 4): Promise<RelevantChunk[]> {
  const allChunks = await prisma.documentChunk.findMany({
    include: { document: { select: { title: true, fileName: true } } },
  });
  if (allChunks.length === 0) return [];

  let questionEmbedding: number[];
  try {
    questionEmbedding = await getEmbedding(question);
  } catch {
    return [];
  }

  const scored = allChunks
    .map((chunk) => {
      const emb = Array.isArray(chunk.embedding)
        ? (chunk.embedding as number[])
        : [];
      return {
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        score: cosineSimilarity(questionEmbedding, emb),
        docTitle: chunk.document.title,
        docFileName: chunk.document.fileName,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((c) => c.score > 0.2);

  return scored;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY no configurado" }, { status: 503 });
  }

  let body: { mode: Mode; message: string; history: HistoryMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { mode, message, history = [] } = body;
  if (!message?.trim()) {
    return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 });
  }

  // Build system prompt + context
  let systemContent = SYSTEM_GENERAL;
  let contextBlock = "";
  let sources: Array<{ title: string; fileName: string; pageNumber: number }> = [];

  if (mode === "tasks") {
    systemContent = SYSTEM_TASKS;
    const taskCtx = await buildTaskContext(session.userId);
    contextBlock = `\n\n${taskCtx}`;
  } else if (mode === "hr") {
    systemContent = SYSTEM_HR;
    const teamCtx = await buildTeamContext(session.userId, session.role as Role);
    const chunks = await findRelevantChunks(message);

    let docBlock = "";
    if (chunks.length > 0) {
      sources = chunks.map((c) => ({
        title: c.docTitle,
        fileName: c.docFileName,
        pageNumber: c.pageNumber,
      }));
      docBlock =
        "DOCUMENTOS BASE RELEVANTES:\n" +
        chunks
          .map(
            (c) =>
              `[Fuente: "${c.docTitle}", pág. ${c.pageNumber}]\n${c.content}`
          )
          .join("\n\n") +
        "\n\n---";
    }

    contextBlock = `\n\n${docBlock}\n${teamCtx}`;
  }

  const systemMessage = systemContent + contextBlock;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: message },
  ];

  try {
    const client = new Groq({ apiKey });
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1500,
      messages,
    });
    const content = response.choices[0]?.message?.content ?? "";
    return NextResponse.json({ content, sources });
  } catch (err) {
    console.error("Groq error:", err);
    return NextResponse.json({ error: "Error al contactar al asistente IA" }, { status: 502 });
  }
}
