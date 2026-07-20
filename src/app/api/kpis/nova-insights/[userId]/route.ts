import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles, ROLE_LEVEL, ROLE_LABEL } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import { computeCargaTiempo } from "@/lib/workload";
import { computeRiskAlerts } from "@/lib/riskAlerts";
import { computePriorityCompliance } from "@/lib/priorityCompliance";
import { computeCapacityForecast } from "@/lib/capacityForecast";
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

type AnalyticalCacheEntry = {
  hallazgoPrincipal: string;
  riesgos: string[];
  aspectosPositivos: string[];
  recomendaciones: string[];
  generatedAt: number;
  expiresAt: number;
};

type MotivationalCacheEntry = {
  messages: string[];
  generatedAt: number;
  expiresAt: number;
};

// Cache en memoria por colaborador + mes + variante de contenido generada —
// "full"/"restricted" (¿incluye detalle de salud del estado especial?) y
// "motivational" son generaciones de Groq DISTINTAS, nunca deben compartir
// entrada (ver `sensitivity` más abajo: evita que un dato de salud generado
// para el propio titular/Administrador se filtre a un viewer sin privilegio,
// dado que esta caché no está aislada por viewer).
const analyticalCache = new Map<string, AnalyticalCacheEntry>();
const motivationalCache = new Map<string, MotivationalCacheEntry>();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// System prompt del motor de recomendaciones Nova — ver Analytics § Componente 4.
// Estructura exigida: 1. Hallazgo principal, 2. Riesgos detectados, 3. Aspectos
// positivos, 4. Recomendaciones priorizadas — pedida como JSON (no texto libre)
// para poder renderizar cada sección por separado en NovaInsightsCard.
const ANALYTICAL_SYSTEM_PROMPT =
  "Eres un analista de People Analytics para un equipo de Recursos Humanos en Ecuador. Analiza los datos " +
  "del colaborador (recibidos en JSON) y responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto " +
  'adicional ni markdown, con esta forma exacta: {"hallazgoPrincipal": string, "riesgos": string[], ' +
  '"aspectosPositivos": string[], "recomendaciones": string[]}. ' +
  "hallazgoPrincipal: el dato más importante del período, en una sola oración con al menos un número. " +
  "riesgos: entre 1 y 3 riesgos concretos respaldados por datos; si no hay riesgos, un único ítem indicándolo " +
  "explícitamente (el array nunca debe quedar vacío). " +
  "aspectosPositivos: entre 1 y 2 aspectos positivos respaldados por números; si no los hay, un único ítem " +
  "indicándolo explícitamente (el array nunca debe quedar vacío). " +
  "recomendaciones: entre 1 y 2 acciones concretas y accionables — qué hacer, cuándo y cómo, nunca genéricas. " +
  "Reglas: sé directo y objetivo, sin eufemismos ni lenguaje complaciente. Cada punto debe tener al menos un " +
  "número o dato específico, basándote ÚNICAMENTE en los datos recibidos (nunca inventes cifras ni menciones " +
  "datos que no se te dieron). Si el cumplimiento es menor a 60%, inclúyelo como riesgo crítico obligatorio. " +
  "Si la carga laboral supera el límite superior configurado, recomienda redistribución citando cifras " +
  "específicas. Si hay tareas vencidas de prioridad Alta, destácalo como urgente. Si hubo horas trabajadas " +
  "en fin de semana, menciónalo como indicador de sobrecarga. Si la tendencia empeoró respecto al mes " +
  "anterior, indícalo con las cifras exactas. Si la capacidad disponible proyectada es menor a 10%, advierte " +
  "que no se debe asignar más trabajo. Si la sobrecarga proyectada es negativa, alértalo con urgencia.";

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
  weekendHours: number;
  capacidadDisponiblePct: number;
  capacidadDisponibleHoras: number;
}): { hallazgoPrincipal: string; riesgos: string[]; aspectosPositivos: string[]; recomendaciones: string[] } {
  const hallazgoPrincipal = `Cumplimiento del período: ${ctx.completedPct}%${
    ctx.cumplimientoDeltaPts !== 0
      ? ` (${ctx.cumplimientoDeltaPts > 0 ? "+" : ""}${ctx.cumplimientoDeltaPts} pp vs. mes anterior)`
      : ""
  }, carga laboral en ${ctx.cargaLabel} (${ctx.cargaPct}%).`;

  const riesgos: string[] = [];
  if (ctx.completedPct < 60) {
    riesgos.push(`Cumplimiento crítico: ${ctx.completedPct}%, por debajo del mínimo aceptable (60%).`);
  }
  if (ctx.overdueAltaCount > 0) {
    riesgos.push(`${ctx.overdueAltaCount} ${pluralize(ctx.overdueAltaCount, "tarea vencida", "tareas vencidas")} de prioridad Alta.`);
  } else if (ctx.overdueCount > 0) {
    riesgos.push(`${ctx.overdueCount} ${pluralize(ctx.overdueCount, "tarea vencida", "tareas vencidas")} en el período.`);
  }
  if (ctx.cargaLabel === "Sobrecarga" || ctx.cargaLabel === "Carga elevada") {
    riesgos.push(`Carga laboral en ${ctx.cargaLabel} (${ctx.cargaPct}%) — por encima del rango óptimo.`);
  }
  if (ctx.weekendHours > 0) {
    riesgos.push(`${ctx.weekendHours}h trabajadas en fin de semana este mes — indicador de sobrecarga.`);
  }
  if (ctx.capacidadDisponiblePct < 10) {
    riesgos.push(
      ctx.capacidadDisponibleHoras < 0
        ? `Sobrecarga proyectada: ${ctx.capacidadDisponibleHoras}h para lo que resta del mes.`
        : `Capacidad disponible proyectada del ${ctx.capacidadDisponiblePct}% — no asignar nuevas tareas.`,
    );
  }
  if (riesgos.length === 0) riesgos.push("Sin riesgos detectados en este período.");

  const aspectosPositivos: string[] = [];
  if (ctx.completedPct >= 80) aspectosPositivos.push(`Cumplimiento del ${ctx.completedPct}%, dentro del rango esperado.`);
  if (ctx.cargaLabel === "Óptimo") aspectosPositivos.push(`Carga laboral en rango Óptimo (${ctx.cargaPct}%).`);
  if (ctx.cumplimientoDeltaPts > 0) aspectosPositivos.push(`Cumplimiento mejoró ${ctx.cumplimientoDeltaPts} pp vs. el mes anterior.`);
  if (aspectosPositivos.length === 0) aspectosPositivos.push("Sin aspectos destacables este período.");

  const recomendaciones: string[] = [];
  if (ctx.overdueAltaCount > 0) {
    recomendaciones.push(
      `Priorizar de inmediato ${ctx.overdueAltaCount === 1 ? "la tarea vencida de prioridad Alta" : `las ${ctx.overdueAltaCount} tareas vencidas de prioridad Alta`} antes de asumir trabajo nuevo.`,
    );
  } else if (ctx.completedPct < 60) {
    recomendaciones.push("El cumplimiento está por debajo del mínimo aceptable (60%) — revisar carga y prioridades con el colaborador esta semana.");
  } else if (ctx.cargaLabel === "Sobrecarga" || ctx.cargaLabel === "Carga elevada") {
    recomendaciones.push("La carga laboral supera el rango óptimo — evaluar redistribuir tareas para evitar desgaste.");
  } else if (ctx.capacidadDisponiblePct < 10) {
    recomendaciones.push("Capacidad disponible por debajo del 10% para lo que resta del mes — no asignar nuevas tareas hasta liberar carga.");
  } else {
    recomendaciones.push("Sin riesgos evidentes este período — mantener el seguimiento habitual.");
  }

  return { hallazgoPrincipal, riesgos, aspectosPositivos, recomendaciones };
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

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function generateAnalytical(
  userId: string,
  monthParam: string,
  sensitivity: Sensitivity,
): Promise<AnalyticalCacheEntry> {
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const { start, end } = monthBounds(year, month);
  let pm = month - 1;
  let py = year;
  if (pm <= 0) { pm = 12; py--; }
  const { start: ps, end: pe } = monthBounds(py, pm);

  const now = new Date();

  const [targetUser, tasks, prevTasks, openTasks, reminders, cargaTiempo, capacityForecast] = await Promise.all([
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
    // Capacidad disponible FUTURA (desde ahora hasta fin de mes) — mismo motor
    // que Analytics § Componente 2, no la capacidad "restante de la base
    // mensual" que usaba cargaTiempo.mensual.rangeMax anteriormente.
    computeCapacityForecast(userId),
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
    capacidadDisponibleFuturaHoras: capacityForecast.disponible,
    capacidadDisponibleFuturaPct: capacityForecast.disponiblePct,
    capacidadEstado: capacityForecast.estadoLabel,
    confiabilidadCalculoPct: capacityForecast.confiabilidad.pct,
    estadoEspecial: especial,
  };

  let hallazgoPrincipal = "";
  let riesgos: string[] = [];
  let aspectosPositivos: string[] = [];
  let recomendaciones: string[] = [];
  if (process.env.GROQ_API_KEY) {
    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: ANALYTICAL_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(ctx) },
        ],
        max_tokens: 600,
        temperature: 0.4,
        response_format: { type: "json_object" },
      });
      const parsed = extractJson(completion.choices[0]?.message?.content ?? "") as
        | { hallazgoPrincipal?: unknown; riesgos?: unknown; aspectosPositivos?: unknown; recomendaciones?: unknown }
        | null;
      hallazgoPrincipal = asString(parsed?.hallazgoPrincipal);
      riesgos = asStringArray(parsed?.riesgos);
      aspectosPositivos = asStringArray(parsed?.aspectosPositivos);
      recomendaciones = asStringArray(parsed?.recomendaciones);
    } catch {
      hallazgoPrincipal = "";
      riesgos = [];
      aspectosPositivos = [];
      recomendaciones = [];
    }
  }
  if (!hallazgoPrincipal || riesgos.length === 0 || aspectosPositivos.length === 0) {
    const fb = fallbackAnalytical({
      completedPct,
      cargaLabel: cargaTiempo.mensual.label,
      cargaPct: cargaTiempo.mensual.pct,
      overdueCount: overdue.length,
      overdueAltaCount: overdueAlta.length,
      cumplimientoDeltaPts,
      weekendHours: cargaTiempo.mensual.weekendHours,
      capacidadDisponiblePct: capacityForecast.disponiblePct,
      capacidadDisponibleHoras: capacityForecast.disponible,
    });
    if (!hallazgoPrincipal) hallazgoPrincipal = fb.hallazgoPrincipal;
    if (riesgos.length === 0) riesgos = fb.riesgos;
    if (aspectosPositivos.length === 0) aspectosPositivos = fb.aspectosPositivos;
    if (recomendaciones.length === 0) recomendaciones = fb.recomendaciones;
  }

  return { hallazgoPrincipal, riesgos, aspectosPositivos, recomendaciones, generatedAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS };
}

async function generateMotivational(userId: string, monthParam: string): Promise<MotivationalCacheEntry> {
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

  let messages: string[] = [];
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
      messages = asStringArray(parsed?.messages);
    } catch {
      messages = [];
    }
  }
  if (messages.length === 0) {
    messages = fallbackMotivational({ completedPct, totalTasks: tasks.length });
  }

  return { messages, generatedAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS };
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

  // VISIBILIDAD (ver Analytics § Componente 4 — motor de recomendaciones Nova):
  // - Administrador / Jefe Nacional / Coordinador Nacional (nivel >= 3): análisis completo (las 4 secciones).
  // - Analistas nivel 2: solo hallazgo principal y aspectos positivos (sin riesgos ni recomendaciones).
  // - Nivel 1 viendo su propia actividad: versión simplificada y motivacional.
  const mode: Mode = isSelf && viewerLevel === 1 ? "motivational" : viewerLevel >= 3 ? "full" : "insights-only";

  // Los permisos médicos y el estado de maternidad/lactancia son datos de
  // salud (Art. 26 LOPDP) — solo el propio titular y el Administrador pueden
  // recibir contenido generado a partir de ese detalle (ver
  // redactSensitiveWorkloadDetail en workload.ts para el mismo criterio
  // aplicado a los datos crudos de carga laboral).
  const sensitivity: Sensitivity = isSelf || session.role === "ADMINISTRADOR" ? "full" : "restricted";

  const monthParam = request.nextUrl.searchParams.get("month") ?? currentMonthParam();

  if (mode === "motivational") {
    const cacheKey = `${userId}:${monthParam}:motivational`;
    const cached = motivationalCache.get(cacheKey);
    const entry = cached && cached.expiresAt > Date.now() ? cached : await generateMotivational(userId, monthParam);
    if (!cached || cached.expiresAt <= Date.now()) motivationalCache.set(cacheKey, entry);
    return NextResponse.json({ mode, messages: entry.messages, generatedAt: entry.generatedAt });
  }

  const cacheKey = `${userId}:${monthParam}:${sensitivity}`;
  const cached = analyticalCache.get(cacheKey);
  const entry = cached && cached.expiresAt > Date.now() ? cached : await generateAnalytical(userId, monthParam, sensitivity);
  if (!cached || cached.expiresAt <= Date.now()) analyticalCache.set(cacheKey, entry);

  if (mode === "insights-only") {
    return NextResponse.json({
      mode,
      hallazgoPrincipal: entry.hallazgoPrincipal,
      aspectosPositivos: entry.aspectosPositivos,
      generatedAt: entry.generatedAt,
    });
  }

  return NextResponse.json({
    mode,
    hallazgoPrincipal: entry.hallazgoPrincipal,
    riesgos: entry.riesgos,
    aspectosPositivos: entry.aspectosPositivos,
    recomendaciones: entry.recomendaciones,
    generatedAt: entry.generatedAt,
  });
}
