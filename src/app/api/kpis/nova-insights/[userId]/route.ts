import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles, ROLE_LEVEL } from "@/lib/roles";
import { isTaskOverdue } from "@/lib/utils";
import { businessCalendarDay } from "@/lib/businessTime";

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

type CacheEntry = {
  bullets: string[];
  recommendation: string | null;
  generatedAt: number;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT =
  "Eres un analista de RRHH objetivo. Analiza los datos y entrega conclusiones directas sin " +
  "suavizar resultados negativos. Si el desempeño es bajo, indícalo claramente. Si hay riesgos, " +
  "nómbralos. El objetivo es información útil para la toma de decisiones, no un reporte que se " +
  "sienta bien leer. Basándote ÚNICAMENTE en los datos que te doy (nunca inventes cifras), redacta " +
  "UNA sola recomendación concreta y accionable (máximo 30 palabras), en español, sin saludos ni " +
  "introducciones y sin eufemismos. Si los datos son buenos, no fuerces una recomendación negativa — " +
  "indica qué mantener o vigilar.";

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

function fallbackRecommendation(ctx: { completedPct: number; cargaRatio: number; overdueCount: number }): string {
  if (ctx.overdueCount > 0) {
    return `Priorizar de inmediato ${ctx.overdueCount === 1 ? "la tarea vencida" : `las ${ctx.overdueCount} tareas vencidas`} antes de asumir trabajo nuevo.`;
  }
  if (ctx.completedPct < 60) {
    return "El cumplimiento está por debajo del mínimo aceptable (60%) — revisar carga de trabajo y prioridades con el colaborador.";
  }
  if (ctx.cargaRatio > 120) {
    return "La carga laboral supera el 120% del estimado — evaluar redistribuir tareas para evitar desgaste.";
  }
  if (ctx.completedPct >= 80 && ctx.cargaRatio <= 100) {
    return "Desempeño estable dentro de rangos óptimos — mantener el ritmo actual.";
  }
  return "Sin riesgos evidentes este período — continuar el seguimiento habitual.";
}

async function generateInsight(userId: string, monthParam: string): Promise<CacheEntry> {
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const { start, end } = monthBounds(year, month);
  let pm = month - 1;
  let py = year;
  if (pm <= 0) { pm = 12; py--; }
  const { start: ps, end: pe } = monthBounds(py, pm);

  const now = new Date();

  const [tasks, prevTasks, openTasks] = await Promise.all([
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
      select: { endDate: true, status: true },
    }),
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

  const today = businessCalendarDay(now);
  const in3Days = new Date(today.getTime() + 3 * 86400000);
  const overdueCount = openTasks.filter((t) => isTaskOverdue(t.endDate, t.status, now)).length;
  const dueSoon = openTasks.filter((t) => {
    if (isTaskOverdue(t.endDate, t.status, now)) return false;
    const endDay = new Date(Date.UTC(t.endDate.getUTCFullYear(), t.endDate.getUTCMonth(), t.endDate.getUTCDate()));
    return endDay.getTime() >= today.getTime() && endDay.getTime() <= in3Days.getTime();
  });

  const cargaDeltaPts = cargaRatio - prevCargaRatio;
  const cumplimientoDeltaPts = completedPct - prevCompletedPct;

  const bullets: string[] = [
    prevTasks.length > 0
      ? `La carga laboral ${cargaDeltaPts > 0 ? "aumentó" : cargaDeltaPts < 0 ? "disminuyó" : "se mantuvo"} ${Math.abs(cargaDeltaPts)} puntos porcentuales respecto al período anterior (${prevCargaRatio}% → ${cargaRatio}%)`
      : `Carga laboral del período: ${cargaRatio}% (sin datos del período anterior para comparar)`,
    topReason
      ? `El ${topReasonPct}% del tiempo de seguimiento se destinó a ${REASON_LABEL[topReason] ?? topReason}`
      : "Sin consultas de tipo SEGUIMIENTO registradas en el período",
    `${dueSoon.length} ${pluralize(dueSoon.length, "tarea próxima", "tareas próximas")} a vencer en los próximos 3 días`,
    prevTasks.length > 0
      ? `El cumplimiento ${cumplimientoDeltaPts > 0 ? "mejoró" : cumplimientoDeltaPts < 0 ? "empeoró" : "se mantuvo"} ${Math.abs(cumplimientoDeltaPts)}% respecto al período anterior (${prevCompletedPct}% → ${completedPct}%)`
      : `Cumplimiento del período: ${completedPct}% (sin datos del período anterior para comparar)`,
  ];

  const ctx = { completedPct, prevCompletedPct, cargaRatio, prevCargaRatio, overdueCount, dueSoonCount: dueSoon.length, topReason: topReason ? REASON_LABEL[topReason] ?? topReason : null, topReasonPct };

  let recommendation: string | null = null;
  if (process.env.GROQ_API_KEY) {
    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(ctx) },
        ],
        max_tokens: 120,
        temperature: 0.4,
      });
      recommendation = completion.choices[0]?.message?.content?.trim() || null;
    } catch {
      recommendation = null;
    }
  }
  if (!recommendation) {
    recommendation = fallbackRecommendation({ completedPct, cargaRatio, overdueCount });
  }

  return { bullets, recommendation, generatedAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS };
}

type Ctx = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const viewerLevel = ROLE_LEVEL[session.role];
  // Insights de Nova solo para roles con subordinados (nivel >= 2, ver
  // Analytics § insights de Nova); niveles 1 no tienen acceso al tab Equipo.
  if (viewerLevel < 2) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const { userId } = await ctx.params;
  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  if (!getVisibleRoles(session.role).includes(targetUser.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const monthParam = request.nextUrl.searchParams.get("month") ?? currentMonthParam();
  const cacheKey = `${userId}:${monthParam}`;
  const cached = cache.get(cacheKey);

  const entry = cached && cached.expiresAt > Date.now() ? cached : await generateInsight(userId, monthParam);
  if (!cached || cached.expiresAt <= Date.now()) cache.set(cacheKey, entry);

  return NextResponse.json({
    bullets: entry.bullets,
    // Nivel 2 (Coordinador ZS / Analistas): insights básicos sin recomendaciones
    // estratégicas — solo nivel >= 3 recibe la recomendación generada por Groq.
    recommendation: viewerLevel >= 3 ? entry.recommendation : null,
    generatedAt: entry.generatedAt,
  });
}
