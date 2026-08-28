import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { ROLE_LABEL, getSubordinateRoles, canViewTeam } from "@/lib/roles";
import { getEmbedding, cosineSimilarity } from "@/lib/embeddings";
import { safeLog } from "@/lib/logger";
import { fetchOwnDjangoTasks } from "@/lib/djangoTasksAdapter";
import type { DjangoTeamMember, DjangoTeamMemberTask } from "@/lib/djangoTeamAdapter";
import { fetchDjangoDocumentChunks } from "@/lib/djangoAssistantAdapter";
import type { Role } from "@/lib/roles";

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

function buildSystemHR(userName: string, userRole: Role): string {
  return `Eres Nova, asistente integral de Gestión de Recursos Humanos para Nexo. Tu propósito es ayudar a resolver cualquier situación o duda relacionada con la gestión de personal en la empresa.

IDENTIDAD:
Si alguien te pregunta quién eres o cómo te llamas, responde que eres Nova, el asistente de RRHH de Nexo.

USUARIO ACTUAL:
Estás respondiendo a ${userName}, quien ocupa el cargo de ${ROLE_LABEL[userRole]}. Adapta tus respuestas y recomendaciones al nivel de responsabilidad y autoridad de este cargo.

ÁREAS EN LAS QUE PUEDES AYUDAR (sin limitarte a estas):
- Conflictos laborales y mediación entre personas
- Procesos de selección y onboarding
- Políticas internas y procedimientos administrativos
- Dudas normativas y legales en materia laboral
- Manejo de situaciones difíciles con colaboradores
- Desempeño, seguimiento y retroalimentación
- Ausentismo, permisos y licencias
- Análisis de carga de trabajo y KPIs del equipo (contexto disponible si aplica)
- Cualquier otra consulta de gestión de personas

PRIORIDAD DE FUENTES:
1. PRIMERA FUENTE: Los documentos cargados en la base de conocimiento de la empresa. Si la pregunta se relaciona con políticas, procedimientos o normativas internas, busca primero en esos documentos y cita la fuente con el formato exacto: (Fuente: Nombre del documento, pág. N)
2. SEGUNDA FUENTE: Si la pregunta no está cubierta en los documentos, responde con buenas prácticas generales de RRHH e indica claramente: "No encontré información específica sobre esto en los documentos de la empresa."

REGLAS:
1. Análisis objetivo. Nunca complaciente — si hay problemas, nómbralos con claridad.
2. Recomendaciones enfocadas en el área o proceso, no en señalar a personas individuales por nombre como responsables de un problema. Puedes mencionar cargos o áreas (ej. "el área de selección"), pero sin culpar directamente a un individuo.
3. Lenguaje profesional y directo. Sin rodeos ni eufemismos.
4. Responde siempre en español.`;
}

const SYSTEM_TASKS = `Eres Nova, asistente de Nexo especializada en gestión de tareas.
Si alguien te pregunta quién eres, responde que eres Nova, el asistente de RRHH de Nexo.
Analizas las tareas del usuario y das recomendaciones concretas de priorización, gestión del tiempo y productividad.
Responde en español, sé directo y accionable.`;

const SYSTEM_GENERAL = `Eres Nova, asistente de Nexo, un sistema interno de gestión de recursos humanos.
Si alguien te pregunta quién eres, responde que eres Nova, el asistente de RRHH de Nexo.
Responde de manera profesional, clara y concisa en español.`;

async function buildTaskContext(): Promise<string> {
  const today = new Date();
  const tasks = await fetchOwnDjangoTasks();
  if (tasks === null) {
    throw new Error("No se pudieron obtener las tareas del usuario (sin sesión Django disponible).");
  }

  if (tasks.length === 0) return "El usuario no tiene tareas asignadas actualmente.";

  const overdue = tasks.filter(
    (t) => t.status !== "COMPLETADA" && new Date(t.end_date) < today
  ).length;

  const lines = tasks.map((t) => {
    const vencida = t.status !== "COMPLETADA" && new Date(t.end_date) < today;
    return `- [${STATUS_LABEL[t.status]}] "${t.title}"
  Prioridad: ${t.priority} | Tipo: ${t.type} | Avance: ${t.progress}%
  Fechas: ${fmt(t.start_date)} → ${fmt(t.end_date)}${vencida ? " ⚠️ VENCIDA" : ""}
  Horas: ${round2(t.estimated_hours)}h de tiempo objetivo / ${round2(t.real_hours)}h reales`;
  });

  return `TAREAS DEL USUARIO (fecha actual: ${fmt(today)}):
Total: ${tasks.length} | Vencidas: ${overdue}
Completadas: ${tasks.filter((t) => t.status === "COMPLETADA").length} | En progreso: ${tasks.filter((t) => t.status === "EN_PROGRESO").length} | Pendientes: ${tasks.filter((t) => t.status === "PENDIENTE").length}

${lines.join("\n\n")}`;
}

async function buildTeamContext(userRole: Role): Promise<string> {
  if (!canViewTeam(userRole)) return "";

  safeLog("log", "[buildTeamContext] userRole:", userRole);
  const subordinateRoles = getSubordinateRoles(userRole);
  safeLog("log", "[buildTeamContext] subordinateRoles:", subordinateRoles);
  if (subordinateRoles.length === 0) return "No hay subordinados asignados.";

  const today = new Date();

  // `/team/` (TeamListView, Fase 18 del backend) ya filtra por los roles
  // subordinados del actor — mismo criterio que `getSubordinateRoles`.
  let members: DjangoTeamMember[];
  try {
    const response = await djangoApiFetch("/team/");
    if (!response || !response.ok) {
      throw new Error(`HTTP ${response?.status ?? "sin sesión Django"}`);
    }
    members = await response.json();
    safeLog("log", "[buildTeamContext] miembros encontrados:", members.length);
  } catch (err) {
    safeLog("error", "[buildTeamContext] ERROR en consulta de usuarios:", err);
    throw new Error(`Consulta de usuarios falló: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (members.length === 0) return "No hay miembros en el equipo con los roles subordinados.";

  // Tareas por miembro, una llamada por persona (mismo patrón que el
  // Prisma original, que tampoco anidaba la consulta).
  const memberLines: string[] = [];
  for (const m of members) {
    let tasks: DjangoTeamMemberTask[] = [];
    try {
      const response = await djangoApiFetch(`/team/${m.id}/tasks/`);
      if (response && response.ok) tasks = await response.json();
    } catch (err) {
      safeLog("error", `[buildTeamContext] ERROR obteniendo tareas de ${m.name}:`, err);
    }

    const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
    const inProgress = tasks.filter((t) => t.status === "EN_PROGRESO").length;
    const overdue = tasks.filter(
      (t) => t.status !== "COMPLETADA" && new Date(t.end_date) < today
    ).length;
    const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
    const estH = round2(tasks.reduce((s, t) => s + (t.estimated_hours ?? 0), 0));
    const realH = round2(tasks.reduce((s, t) => s + (t.real_hours ?? 0), 0));
    const carga = estH > 0 ? Math.round((realH / estH) * 100) : 0;
    const avgProg =
      inProgress > 0
        ? Math.round(
            tasks
              .filter((t) => t.status === "EN_PROGRESO")
              .reduce((s, t) => s + (t.progress ?? 0), 0) / inProgress
          )
        : 0;

    memberLines.push(
      `${m.name} (${ROLE_LABEL[m.role as Role] ?? m.role}):
  Tareas: ${tasks.length} total | ${completed} completadas (${pct}%) | ${inProgress} en curso | ${overdue} vencidas
  Horas: ${estH}h de tiempo objetivo / ${realH}h reales → Carga: ${carga}%${inProgress > 0 ? ` | Avance prom. en curso: ${avgProg}%` : ""}`
    );
  }

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
  const allChunks = await fetchDjangoDocumentChunks();
  if (allChunks.length === 0) return [];

  let questionEmbedding: number[];
  try {
    questionEmbedding = await getEmbedding(question);
  } catch (err) {
    safeLog("error", "[findRelevantChunks] fallo generando el embedding de la pregunta:", err);
    return [];
  }

  const scored = allChunks
    .map((chunk) => ({
      content: chunk.content,
      pageNumber: chunk.page_number,
      score: cosineSimilarity(questionEmbedding, Array.isArray(chunk.embedding) ? chunk.embedding : []),
      docTitle: chunk.doc_title,
      docFileName: chunk.doc_file_name,
    }))
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
  safeLog("log", "[assistant/chat] GROQ_API_KEY presente:", !!apiKey);
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

  safeLog("log", `[assistant/chat] modo=${mode} userId=${session.userId} role=${session.role}`);

  // Build system prompt + context
  let systemContent = SYSTEM_GENERAL;
  let contextBlock = "";
  let sources: Array<{ title: string; fileName: string; pageNumber: number }> = [];

  try {
    if (mode === "tasks") {
      systemContent = SYSTEM_TASKS;
      safeLog("log", "[assistant/chat] Construyendo contexto de tareas...");
      const taskCtx = await buildTaskContext();
      contextBlock = `\n\n${taskCtx}`;
      safeLog("log", "[assistant/chat] Contexto tareas OK, chars:", taskCtx.length);
    } else if (mode === "hr") {
      systemContent = buildSystemHR(session.name, session.role as Role);

      safeLog("log", "[assistant/chat] Construyendo contexto de equipo...");
      let teamCtx = "";
      try {
        teamCtx = await buildTeamContext(session.role as Role);
        safeLog("log", "[assistant/chat] Contexto equipo OK, chars:", teamCtx.length);
      } catch (teamErr) {
        // Sprint C §7: el detalle técnico queda solo en el log del servidor —
        // antes se insertaba crudo en el contexto que recibe el modelo, con
        // riesgo de que Nova lo repitiera textualmente al usuario.
        safeLog("error", "[assistant/chat] ERROR en buildTeamContext:", teamErr);
        teamCtx = "[No se pudo cargar el contexto del equipo]";
      }

      safeLog("log", "[assistant/chat] Buscando chunks relevantes...");
      let chunks: RelevantChunk[] = [];
      try {
        chunks = await findRelevantChunks(message);
        safeLog("log", "[assistant/chat] Chunks encontrados:", chunks.length);
      } catch (chunkErr) {
        const msg = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
        safeLog("error", "[assistant/chat] ERROR en findRelevantChunks:", msg);
        // Non-fatal: proceed without document context
      }

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
  } catch (err) {
    safeLog("error", "[assistant/chat] ERROR construyendo contexto:", err);
    return NextResponse.json(
      { error: "Error al preparar el contexto de la conversación" },
      { status: 500 }
    );
  }

  const systemMessage = systemContent + contextBlock;
  safeLog(
    "log",
    `[assistant/chat] System message chars: ${systemMessage.length} | History messages: ${history.length}`
  );

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: message },
  ];

  try {
    safeLog("log", "[assistant/chat] Llamando a Groq...");
    const client = new Groq({ apiKey });
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1500,
      messages,
    });
    const content = response.choices[0]?.message?.content ?? "";
    // Registro de uso de Groq: solo metadatos (timestamp, userId, modo, tokens aproximados).
    // Nunca el texto de la consulta, los fragmentos RAG ni la respuesta del modelo.
    safeLog(
      "log",
      `[assistant/chat] uso Groq: ts=${new Date().toISOString()} userId=${session.userId} modo=${mode} tokensAprox=${response.usage?.total_tokens ?? "n/a"}`
    );
    return NextResponse.json({ content, sources });
  } catch (err) {
    safeLog("error", "[assistant/chat] ERROR Groq:", err);
    // Detectar error de límite de tokens
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("token") || errMsg.includes("limit") || errMsg.includes("context_length")) {
      return NextResponse.json(
        { error: "El contexto es demasiado extenso para el modelo. Intenta una pregunta más específica." },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: "Error al contactar al asistente IA" }, { status: 502 });
  }
}
