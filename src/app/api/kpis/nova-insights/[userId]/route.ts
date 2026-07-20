import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles, ROLE_LEVEL, ROLE_LABEL } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import { computeCargaTiempo } from "@/lib/workload";
import { computeRiskAlerts } from "@/lib/riskAlerts";
import { computePriorityCompliance } from "@/lib/priorityCompliance";
import type { Role } from "@/generated/prisma/client";

// Etiquetas de motivo de SEGUIMIENTO — copia server-side minimal de
// REASON_LABEL (src/components/kpis/KpiCharts.tsx, "use client") para no
// importar un módulo cliente desde un route handler.
const REASON_LABEL: Record<string, string> = {
  NOVEDADES_PAGO: "Novedades de pago",
  RETENCION_PAGO: "Retención de pago",
  FACTURAS: "Facturas",
  CONSULTA_OPERACIONES: "Consulta operaciones",
  SOLICITUD_VACACIONES: "Solicitud vacaciones",
  SOLICITUD_PERMISO: "Solicitud permiso",
  VISITA_DOMICILIARIA: "Visita domiciliaria",
  SEGUIMIENTO_AUSENTISMOS: "Seg. ausentismos",
  RECLUTAMIENTO_SELECCION: "Reclutamiento/Selección",
  SEGUIMIENTO_DOCUMENTACION: "Seguimiento de documentación",
  SOLICITUDES_INTERNAS: "Solicitudes internas",
};

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas

type Mode = "full" | "insights-only" | "motivational";
type Sensitivity = "full" | "restricted";

type CacheEntry = {
  bullets: string[];
  recommendations: string[];
  generatedAt: number;
  expiresAt: number;
};

// Cache en memoria por colaborador + mes + variante de contenido generada —
// "full"/"restricted" (¿incluye detalle de salud del estado especial?) y
// "motivational" son generaciones de Groq DISTINTAS, nunca deben compartir
// entrada (ver `sensitivity` más abajo: evita que un dato de salud generado
// para el propio titular/Administrador se filtre a un viewer sin privilegio,
// dado que esta caché no está aislada por viewer).
const cache = new Map<string, CacheEntry>();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const ANALYTICAL_SYSTEM_PROMPT =
  "Eres un analista de People Analytics para un equipo de Recursos Humanos en Ecuador. Analiza los " +
  "siguientes datos del colaborador (recibidos en JSON) y genera un análisis objetivo, sin suavizar " +
  "resultados negativos — si hay problemas, nómbralos sin eufemismos; si el desempeño es bueno, confírmalo " +
  "con datos concretos. Reglas: si el cumplimiento es menor a 60%, menciónalo explícitamente como riesgo; " +
  "si la carga laboral supera el rango óptimo, recomienda redistribución citando cifras específicas; si hay " +
  "tareas vencidas de prioridad Alta, destácalo como urgente; si hubo horas trabajadas en fin de semana, " +
  "menciónalo como indicador de sobrecarga; si la tendencia empeoró respecto al mes anterior, indícalo con " +
  "las cifras exactas; si todo está bien, confírmalo con los números que lo respaldan. Basándote " +
  "ÚNICAMENTE en los datos recibidos (nunca inventes cifras ni menciones datos que no se te dieron), " +
  'responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional ni markdown, con esta forma ' +
  'exacta: {"insights": string[], "recommendations": string[]}. "insights" debe tener entre 3 y 5 bullets ' +
  "en español, cada uno con al menos un dato específico, sin viñetas ni saludos ni introducciones. " +
  '"recommendations" debe tener entre 1 y 2 recomendaciones concretas y accionables (qué hacer, cuándo y ' +
  "cómo) — nunca genéricas.";

const MOTIVATIONAL_SYSTEM_PROMPT =
  "Eres Nova, la asistente de People Analytics de Nexo. Genera un mensaje breve, cercano y motivador para " +
  "un colaborador sobre su propio desempeño del mes, basado ÚNICAMENTE en los datos recibidos (en JSON, " +
  "nunca inventes cifras). Usa un tono cálido y de apoyo, en español simple, sin tecnicismos de RRHH. Si " +
  "hay algo que mejorar, menciónalo con delicadeza y de forma constructiva — nunca alarmante. Responde " +
  'EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional ni markdown, con esta forma exacta: ' +
  '{"messages": string[]}, con entre 2 y 3 mensajes cortos (una frase natural cada uno, sin viñetas).';

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function currentMonthParam(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ── Fallbacks deterministas (sin Groq / si la llamada falla) ─────────────────

function fallbackAnalytical(ctx: {
  completedPct: number;
  cargaLabel: string;
  cargaPct: number;
  overdueCount: number;
  overdueAltaCount: number;
  cumplimientoDeltaPts: number;
}): { bullets: string[]; recommendations: string[] } {
  const bullets = [
    `Cumplimiento del período: ${ctx.completedPct}%${
      ctx.cumplimientoDeltaPts !== 0
        ? ` (${ctx.cumplimientoDeltaPts > 0 ? "+" : ""}${ctx.cumplimientoDeltaPts} pp vs. mes anterior)`
        : ""
    }`,
    `Carga laboral del mes en ${ctx.cargaLabel} (${ctx.cargaPct}%)`,
    ctx.overdueCount > 0
      ? `${ctx.overdueCount} ${pluralize(ctx.overdueCount, "tarea vencida", "tareas vencidas")}${
          ctx.overdueAltaCount > 0 ? ` (${ctx.overdueAltaCount} de prioridad Alta)` : ""
        }`
      : "Sin tareas vencidas en este período",
  ];
  const recommendations: string[] = [];
  if (ctx.overdueAltaCount > 0) {
    recommendations.push(
      `Priorizar de inmediato ${ctx.overdueAltaCount === 1 ? "la tarea vencida de prioridad Alta" : `las ${ctx.overdueAltaCount} tareas vencidas de prioridad Alta`} antes de asumir trabajo nuevo.`,
    );
  } else if (ctx.completedPct < 60) {
    recommendations.push("El cumplimiento está por debajo del mínimo aceptable (60%) — revisar carga y prioridades con el colaborador esta semana.");
  } else if (ctx.cargaLabel === "Sobrecarga" || ctx.cargaLabel === "Carga elevada") {
    recommendations.push("La carga laboral supera el rango óptimo — evaluar redistribuir tareas para evitar desgaste.");
  } else {
    recommendations.push("Sin riesgos evidentes este período — mantener el seguimiento habitual.");
  }
  return { bullets, recommendations };
}

function fallbackMotivational(ctx: { completedPct: number; totalTasks: number }): string[] {
  if (ctx.totalTasks === 0) {
    return ["No hay tareas registradas en este período todavía.", "Consulta con tu coordinador si hay actividades pendientes de asignar."];
  }
  if (ctx.completedPct >= 80) {
    return [`¡Excelente mes! Cumpliste el ${ctx.completedPct}% de tus tareas.`, "Sigue así, tu ritmo de trabajo está muy bien encaminado."];
  }
  if (ctx.completedPct >= 60) {
    return [`Vas bien: ${ctx.completedPct}% de cumplimiento este período.`, "Con un poco más de foco en las tareas pendientes puedes subir aún más."];
  }
  return [`Este período tu cumplimiento fue ${ctx.completedPct}%.`, "No te desanimes — revisa tus tareas pendientes y prioriza con tu supervisor si necesitas apoyo."];
}

/** Extrae el primer objeto JSON `{...}` de un texto (Groq a veces envuelve la respuesta en markdown pese a la instrucción). */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

async function generateAnalytical(
  userId: string,
  monthParam: string,
  sensitivity: Sensitivity,
): Promise<CacheEntry> {
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const { start, end } = monthBounds(year, month);
  let pm = month - 1;
  let py = year;
  if (pm <= 0) { pm = 12; py--; }
  const { start: ps, end: pe } = monthBounds(py, pm);

  const now = new Date();

  const [targetUser, tasks, prevTasks, openTasks, reminders, cargaTiempo] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } }),
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: start, lte: end } },
      include: { activities: { where: { createdAt: { gte: start, lte: end } } } },
    }),
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: ps, lte: pe } },
      select: { status: true, estimatedHours: true, realHours: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: userId, archivedMonth: null, status: { not: "COMPLETADA" } },
      select: { endDate: true, status: true, priority: true },
    }),
    prisma.followUpReminder.findMany({
      where: { userId, completedAt: null },
      select: { reminderAt: true, snoozedUntil: true },
    }),
    // Siempre en tiempo real (no atado al mes seleccionado) — igual que
    // WorkloadCard/riskAlerts en el resto de Analytics.
    computeCargaTiempo(userId),
  ]);

  const completed = tasks.filter((t) => t.status === "COMPLETADA");
  const completedPct = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;
  const totalEstimated = tasks.reduce((s, t) => s + t.estimatedHours, 0);
  const totalReal = tasks.reduce((s, t) => s + t.realHours, 0);
  const cargaRatio = totalEstimated > 0 ? Math.round((totalReal / totalEstimated) * 100) : totalReal > 0 ? 200 : 0;

  const prevCompleted = prevTasks.filter((t) => t.status === "COMPLETADA").length;
  const prevCompletedPct = prevTasks.length > 0 ? Math.round((prevCompleted / prevTasks.length) * 100) : 0;
  const prevEst = prevTasks.reduce((s, t) => s + t.estimatedHours, 0);
  const prevReal = prevTasks.reduce((s, t) => s + t.realHours, 0);
  const prevCargaRatio = prevEst > 0 ? Math.round((prevReal / prevEst) * 100) : 0;

  const seguimientoTasks = tasks.filter((t) => t.type === "SEGUIMIENTO");
  const allActivities = seguimientoTasks.flatMap((t) => t.activities);
  const byReasonMinutes = new Map<string, number>();
  for (const act of allActivities) {
    byReasonMinutes.set(act.reason, (byReasonMinutes.get(act.reason) ?? 0) + act.duration);
  }
  let topReason: string | null = null;
  let topMinutes = 0;
  let totalMinutes = 0;
  for (const [reason, mins] of byReasonMinutes) {
    totalMinutes += mins;
    if (mins > topMinutes) {
      topMinutes = mins;
      topReason = reason;
    }
  }
  const topReasonPct = totalMinutes > 0 ? Math.round((topMinutes / totalMinutes) * 100) : 0;

  const overdue = openTasks.filter((t) => isTaskOverdue(t.endDate, t.status, now));
  const overdueAlta = overdue.filter((t) => t.priority === "ALTA");
  const overdueReminders = reminders.filter((r) => (r.snoozedUntil ?? r.reminderAt).getTime() < now.getTime());

  const priorityCompliance = computePriorityCompliance(tasks);

  const riskAlerts = await computeRiskAlerts({
    userId,
    cargaLabel: cargaTiempo.mensual.label,
    cargaPct: cargaTiempo.mensual.pct,
  });

  const horasDisponibles = Math.max(0, Math.round((cargaTiempo.mensual.rangeMax - cargaTiempo.mensual.realHours) * 100) / 100);
  const capacidadDisponiblePct =
    cargaTiempo.mensual.baseHours > 0 ? Math.max(0, Math.round((horasDisponibles / cargaTiempo.mensual.baseHours) * 100)) : 0;

  const cargaDeltaPts = cargaRatio - prevCargaRatio;
  const cumplimientoDeltaPts = completedPct - prevCompletedPct;

  const especial =
    sensitivity === "full" && cargaTiempo.mensual.specialStatusType
      ? cargaTiempo.mensual.specialStatusType === "MATERNIDAD"
        ? "Licencia de maternidad vigente este mes"
        : "Período de lactancia vigente este mes"
      : null;

  const ctx = {
    nombre: targetUser?.name ?? "Colaborador",
    rol: targetUser ? (ROLE_LABEL[targetUser.role as Role] ?? targetUser.role) : "",
    cargaLaboralPctEstimadoVsReal: cargaRatio,
    cargaLaboralTendenciaPuntos: prevTasks.length > 0 ? cargaDeltaPts : null,
    cargaLaboralRangoLabel: cargaTiempo.mensual.label,
    cargaLaboralRangoPct: cargaTiempo.mensual.pct,
    horasFinDeSemanaEsteMes: cargaTiempo.mensual.weekendHours,
    cumplimientoPct: completedPct,
    cumplimientoTendenciaPuntos: prevTasks.length > 0 ? cumplimientoDeltaPts : null,
    tareasVencidas: overdue.length,
    tareasVencidasPrioridadAlta: overdueAlta.length,
    recordatoriosVencidos: overdueReminders.length,
    cumplimientoPorPrioridad: priorityCompliance.filter((p) => p.total > 0),
    motivoSeguimientoMasFrecuente: topReason ? REASON_LABEL[topReason] ?? topReason : null,
    motivoSeguimientoPctDeTiempo: topReasonPct,
    alertasActivas: riskAlerts.map((a) => a.message),
    capacidadDisponiblePct,
    horasDisponiblesEstimadas: horasDisponibles,
    estadoEspecial: especial,
  };

  let bullets: string[] = [];
  let recommendations: string[] = [];
  if (process.env.GROQ_API_KEY) {
    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: ANALYTICAL_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(ctx) },
        ],
        max_tokens: 500,
        temperature: 0.4,
        response_format: { type: "json_object" },
      });
      const parsed = extractJson(completion.choices[0]?.message?.content ?? "") as
        | { insights?: unknown; recommendations?: unknown }
        | null;
      bullets = asStringArray(parsed?.insights);
      recommendations = asStringArray(parsed?.recommendations);
    } catch {
      bullets = [];
      recommendations = [];
    }
  }
  if (bullets.length === 0) {
    const fb = fallbackAnalytical({
      completedPct,
      cargaLabel: cargaTiempo.mensual.label,
      cargaPct: cargaTiempo.mensual.pct,
      overdueCount: overdue.length,
      overdueAltaCount: overdueAlta.length,
      cumplimientoDeltaPts,
    });
    bullets = fb.bullets;
    if (recommendations.length === 0) recommendations = fb.recommendations;
  }

  return { bullets, recommendations, generatedAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS };
}

async function generateMotivational(userId: string, monthParam: string): Promise<CacheEntry> {
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const { start, end } = monthBounds(year, month);

  const [targetUser, tasks] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.task.findMany({
      where: { assignedToId: userId, endDate: { gte: start, lte: end } },
      select: { status: true },
    }),
  ]);
  const completed = tasks.filter((t) => t.status === "COMPLETADA").length;
  const completedPct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

  const ctx = {
    nombre: targetUser?.name ?? "Colaborador",
    cumplimientoPct: completedPct,
    totalTareas: tasks.length,
    tareasCompletadas: completed,
  };

  let bullets: string[] = [];
  if (process.env.GROQ_API_KEY) {
    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: MOTIVATIONAL_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(ctx) },
        ],
        max_tokens: 220,
        temperature: 0.6,
        response_format: { type: "json_object" },
      });
      const parsed = extractJson(completion.choices[0]?.message?.content ?? "") as { messages?: unknown } | null;
      bullets = asStringArray(parsed?.messages);
    } catch {
      bullets = [];
    }
  }
  if (bullets.length === 0) {
    bullets = fallbackMotivational({ completedPct, totalTasks: tasks.length });
  }

  return { bullets, recommendations: [], generatedAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS };
}

type Ctx = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;
  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const isSelf = session.userId === userId;
  const viewerLevel = ROLE_LEVEL[session.role];

  if (!isSelf) {
    // Insights de Nova sobre OTRA persona: solo roles con subordinados (nivel
    // >= 2, niveles 1 no tienen acceso al tab Equipo), y dentro del alcance
    // de visibilidad del viewer.
    if (viewerLevel < 2) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    if (!getVisibleRoles(session.role).includes(targetUser.role)) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
  }

  // VISIBILIDAD (ver Analytics § motor de recomendaciones Nova):
  // - Administrador / Jefe Nacional / Coordinador Nacional (nivel >= 3): análisis completo + recomendaciones.
  // - Analistas nivel 2: solo insights, sin recomendaciones estratégicas.
  // - Nivel 1 viendo su propia actividad: versión simplificada y motivacional.
  const mode: Mode = isSelf && viewerLevel === 1 ? "motivational" : viewerLevel >= 3 ? "full" : "insights-only";

  // Los permisos médicos y el estado de maternidad/lactancia son datos de
  // salud (Art. 26 LOPDP) — solo el propio titular y el Administrador pueden
  // recibir contenido generado a partir de ese detalle (ver
  // redactSensitiveWorkloadDetail en workload.ts para el mismo criterio
  // aplicado a los datos crudos de carga laboral).
  const sensitivity: Sensitivity = isSelf || session.role === "ADMINISTRADOR" ? "full" : "restricted";

  const monthParam = request.nextUrl.searchParams.get("month") ?? currentMonthParam();
  const variant = mode === "motivational" ? "motivational" : sensitivity;
  const cacheKey = `${userId}:${monthParam}:${variant}`;
  const cached = cache.get(cacheKey);

  const entry =
    cached && cached.expiresAt > Date.now()
      ? cached
      : mode === "motivational"
        ? await generateMotivational(userId, monthParam)
        : await generateAnalytical(userId, monthParam, sensitivity);
  if (!cached || cached.expiresAt <= Date.now()) cache.set(cacheKey, entry);

  return NextResponse.json({
    bullets: entry.bullets,
    recommendations: mode === "full" ? entry.recommendations : [],
    mode,
    generatedAt: entry.generatedAt,
  });
}
