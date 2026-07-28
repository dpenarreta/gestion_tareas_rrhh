import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isTaskOverdue } from "@/lib/utils";
import { weekBounds, monthBounds } from "@/lib/dateRanges";
import { computeCargaTiempo } from "@/lib/workload";
import { isLeadershipRole } from "@/lib/roles";
import { getEffectiveNovaCacheTtlMinutes } from "@/lib/systemConfig";
import Groq from "groq-sdk";

const cache = new Map<string, { message: string; expiresAt: number; generatedAt: number }>();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function pluralize(n: number, singular: string, plural: string) {
  return n === 1 ? singular : plural;
}

function buildFallback(ctx: {
  tareasVencidas: number;
  tareasPorVencer: number;
  cargaHoyPct: number;
  cargaHoyHoras: number;
  cargaHoyBase: number;
  esFinDeSemana: boolean;
  completadasMes: number;
  esLiderazgo: boolean;
}): string {
  if (ctx.tareasVencidas > 0) {
    return `Revisión urgente: tienes ${ctx.tareasVencidas} ${pluralize(ctx.tareasVencidas, "tarea vencida", "tareas vencidas")}.`;
  }
  if (ctx.tareasPorVencer > 0) {
    return `Tienes ${ctx.tareasPorVencer} ${pluralize(ctx.tareasPorVencer, "tarea próxima a vencer", "tareas próximas a vencer")} esta semana.`;
  }
  // Roles de dirección no ejecutan tareas operativas — su carga laboral
  // individual no es representativa (ver isLeadershipRole en roles.ts).
  if (!ctx.esLiderazgo && !ctx.esFinDeSemana && (ctx.cargaHoyPct > 120 || ctx.cargaHoyPct < 60)) {
    return `Tu carga laboral hoy es del ${ctx.cargaHoyPct}% (${ctx.cargaHoyHoras}h de ${ctx.cargaHoyBase}h).`;
  }
  if (ctx.completadasMes > 0) {
    return `Buen ritmo: completaste ${ctx.completadasMes} ${pluralize(ctx.completadasMes, "tarea", "tareas")} este mes.`;
  }
  if (ctx.esLiderazgo) {
    return "Bienvenido a Nexo. Revisa los indicadores del equipo para comenzar el día.";
  }
  return "Bienvenido a Nexo. Revisa tus tareas pendientes para comenzar el día.";
}

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const cached = cache.get(session.userId);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ message: cached.message, cached: true });
  }
  const cacheTtlMs = (await getEffectiveNovaCacheTtlMinutes()) * 60 * 1000;

  const now = new Date();
  const { end: weekEnd } = weekBounds(now);
  const { start: monthStart, end: monthEnd } = monthBounds(now);

  const tasks = await prisma.task.findMany({
    where: { assignedToId: session.userId, archivedMonth: null },
    select: { status: true, endDate: true },
  });

  const tareasVencidas = tasks.filter((t) => isTaskOverdue(t.endDate, t.status, now)).length;
  const tareasPorVencer = tasks.filter(
    (t) => t.status !== "COMPLETADA" && t.endDate >= now && t.endDate <= weekEnd
  ).length;
  const completadasMes = tasks.filter(
    (t) => t.status === "COMPLETADA" && t.endDate >= monthStart && t.endDate <= monthEnd
  ).length;

  const cargaTiempo = await computeCargaTiempo(session.userId, now);
  const ctx = {
    tareasVencidas,
    tareasPorVencer,
    cargaHoyPct: cargaTiempo.diaria.pct,
    cargaHoyHoras: cargaTiempo.diaria.realHours,
    cargaHoyBase: cargaTiempo.diaria.baseHours,
    esFinDeSemana: cargaTiempo.diaria.isWeekend,
    completadasMes,
    esLiderazgo: isLeadershipRole(session.role),
  };

  const fallback = buildFallback(ctx);

  if (!process.env.GROQ_API_KEY) {
    cache.set(session.userId, { message: fallback, expiresAt: Date.now() + cacheTtlMs, generatedAt: Date.now() });
    return NextResponse.json({ message: fallback, cached: false });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content:
            "Eres Nova, asistente de Nexo. Genera UN mensaje corto (máximo 25 palabras) para el dashboard del usuario, en español, sin saludo, directo y accionable. " +
            "Basa el mensaje ÚNICAMENTE en los datos reales que te doy, usando los números exactos, sin inventar nada. " +
            "Prioriza en este orden: (1) si hay tareas vencidas, alerta sobre eso primero con tono de urgencia; " +
            "(2) si no hay vencidas pero hay tareas por vencer esta semana, menciónalas; " +
            "(3) si no hay ninguna de las dos, hoy NO es fin de semana (esFinDeSemana=false), y la carga laboral de hoy es mayor a 120% o menor a 60%, coméntalo con el porcentaje y las horas — si esFinDeSemana=true, nunca comentes el porcentaje de carga de hoy, pasa directo a la regla (4); " +
            "(4) si todo está en orden, felicita por las tareas completadas este mes. " +
            "Si esLiderazgo=true (rol de dirección: Administrador o Jefe Nacional), IGNORA por completo la regla (3) — nunca menciones carga laboral, horas ni porcentajes individuales para este rol, ya que dirige equipos y no ejecuta tareas operativas; salta directo a la regla (4) o, si tampoco aplica, sugiere revisar los indicadores del equipo. " +
            "Ejemplos de estilo: \"Revisión urgente: tienes 3 tareas vencidas\", \"Tienes 2 tareas próximas a vencer esta semana\", " +
            "\"Tu carga laboral hoy es del 130% (10.4h de 8h)\", \"Buen ritmo: completaste 5 tareas este mes\".",
        },
        {
          role: "user",
          content: JSON.stringify(ctx),
        },
      ],
      max_tokens: 60,
      temperature: 0.5,
    });

    const message = completion.choices[0]?.message?.content?.trim() || fallback;

    cache.set(session.userId, { message, expiresAt: Date.now() + cacheTtlMs, generatedAt: Date.now() });
    return NextResponse.json({ message, cached: false });
  } catch {
    cache.set(session.userId, { message: fallback, expiresAt: Date.now() + cacheTtlMs, generatedAt: Date.now() });
    return NextResponse.json({ message: fallback, cached: false });
  }
}
