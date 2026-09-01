import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { fetchOwnDjangoTasks } from "@/lib/djangoTasksAdapter";
import { isTaskOverdue } from "@/lib/utils";
import { weekBounds, monthBounds } from "@/lib/dateRanges";
import { isLeadershipRole } from "@/lib/roles";
import { fetchDjangoNovaCacheTtlMinutes } from "@/lib/djangoNovaCacheConfig";
import { GoogleGenAI } from "@google/genai";

const cache = new Map<string, { message: string; expiresAt: number; generatedAt: number }>();

const GENERIC_FALLBACK_MESSAGE = "Bienvenido a Nexo. Revisa tus tareas pendientes para comenzar el día.";

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
  return GENERIC_FALLBACK_MESSAGE;
}

type DjangoDiariaCarga = { real_hours: number; base_hours: number; pct: number; is_weekend: boolean };
type DjangoKpiMePayload = { carga_tiempo: { diaria: DjangoDiariaCarga } };

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-24): tareas propias vía
// `fetchOwnDjangoTasks` (`apps.tasks`, Fase 3a — ya filtra
// assigned_to=request.user + archived_month__isnull=True, igual que la
// query de Prisma original) y carga de tiempo del día vía `GET /kpis/me/`
// (`apps.analytics`, Fase 4a/4b — único endpoint que ya expone `diaria`).
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const cached = cache.get(String(session.djangoUserId));
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ message: cached.message, cached: true });
  }
  const cacheTtlMs = (await fetchDjangoNovaCacheTtlMinutes()) * 60 * 1000;

  const now = new Date();
  const { end: weekEnd } = weekBounds(now);
  const { start: monthStart, end: monthEnd } = monthBounds(now);

  const [tasks, kpiResponse] = await Promise.all([fetchOwnDjangoTasks(), djangoApiFetch("/kpis/me/")]);

  // Ruta puramente cosmética (saludo del Dashboard) — nunca falló por un
  // problema de datos antes de este cutover; si la sesión todavía no tiene
  // acceso a Django, se degrada al mismo saludo genérico en vez de exponer
  // un error, en vez de adoptar el patrón de 401 usado en el resto de la
  // migración (criterio distinto, deliberado para esta única ruta).
  if (tasks === null || !kpiResponse || !kpiResponse.ok) {
    cache.set(String(session.djangoUserId), { message: GENERIC_FALLBACK_MESSAGE, expiresAt: Date.now() + cacheTtlMs, generatedAt: Date.now() });
    return NextResponse.json({ message: GENERIC_FALLBACK_MESSAGE, cached: false });
  }

  const kpi = (await kpiResponse.json()) as DjangoKpiMePayload;
  const diaria = kpi.carga_tiempo.diaria;

  const tareasVencidas = tasks.filter((t) => isTaskOverdue(t.end_date, t.status, now)).length;
  const tareasPorVencer = tasks.filter(
    (t) => t.status !== "COMPLETADA" && new Date(t.end_date) >= now && new Date(t.end_date) <= weekEnd
  ).length;
  const completadasMes = tasks.filter(
    (t) => t.status === "COMPLETADA" && new Date(t.end_date) >= monthStart && new Date(t.end_date) <= monthEnd
  ).length;

  const ctx = {
    tareasVencidas,
    tareasPorVencer,
    cargaHoyPct: diaria.pct,
    cargaHoyHoras: diaria.real_hours,
    cargaHoyBase: diaria.base_hours,
    esFinDeSemana: diaria.is_weekend,
    completadasMes,
    esLiderazgo: isLeadershipRole(session.role),
  };

  const fallback = buildFallback(ctx);

  if (!process.env.GEMINI_API_KEY) {
    cache.set(String(session.djangoUserId), { message: fallback, expiresAt: Date.now() + cacheTtlMs, generatedAt: Date.now() });
    return NextResponse.json({ message: fallback, cached: false });
  }

  try {
    // Construido acá, no a nivel de módulo — mismo criterio defensivo que el
    // resto de las rutas de Nova (ver `generateNarrative.ts`), aunque el SDK
    // de Gemini (a diferencia de `groq-sdk`) no lanza síncronamente si falta
    // la key.
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const completion = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: JSON.stringify(ctx) }] }],
      config: {
        systemInstruction:
          "Eres Nova, asistente de Nexo. Genera UN mensaje corto (máximo 25 palabras) para el dashboard del usuario, en español, sin saludo, directo y accionable. " +
          "Basa el mensaje ÚNICAMENTE en los datos reales que te doy, usando los números exactos, sin inventar nada. " +
          "Prioriza en este orden: (1) si hay tareas vencidas, alerta sobre eso primero con tono de urgencia; " +
          "(2) si no hay vencidas pero hay tareas por vencer esta semana, menciónalas; " +
          "(3) si no hay ninguna de las dos, hoy NO es fin de semana (esFinDeSemana=false), y la carga laboral de hoy es mayor a 120% o menor a 60%, coméntalo con el porcentaje y las horas — si esFinDeSemana=true, nunca comentes el porcentaje de carga de hoy, pasa directo a la regla (4); " +
          "(4) si todo está en orden, felicita por las tareas completadas este mes. " +
          "Si esLiderazgo=true (rol de dirección: Administrador o Jefe Nacional), IGNORA por completo la regla (3) — nunca menciones carga laboral, horas ni porcentajes individuales para este rol, ya que dirige equipos y no ejecuta tareas operativas; salta directo a la regla (4) o, si tampoco aplica, sugiere revisar los indicadores del equipo. " +
          "Ejemplos de estilo: \"Revisión urgente: tienes 3 tareas vencidas\", \"Tienes 2 tareas próximas a vencer esta semana\", " +
          "\"Tu carga laboral hoy es del 130% (10.4h de 8h)\", \"Buen ritmo: completaste 5 tareas este mes\".",
        // `gemini-3.6-flash` consume tokens de "thinking" del MISMO
        // presupuesto que `maxOutputTokens` (variable, medido entre ~50 y
        // ~600 tokens incluso para prompts triviales — no puede desactivarse:
        // `thinkingBudget: 0` es rechazado con 400 por este modelo, y un
        // `thinkingBudget` explícito bajo no lo acota de forma confiable).
        // Sin margen amplio, la respuesta se trunca a mitad de frase
        // (`finishReason: "MAX_TOKENS"`) — verificado en vivo contra la API
        // real antes de fijar este valor.
        maxOutputTokens: 1536,
        temperature: 0.5,
      },
    });

    const message = completion.text?.trim() || fallback;

    cache.set(String(session.djangoUserId), { message, expiresAt: Date.now() + cacheTtlMs, generatedAt: Date.now() });
    return NextResponse.json({ message, cached: false });
  } catch {
    cache.set(String(session.djangoUserId), { message: fallback, expiresAt: Date.now() + cacheTtlMs, generatedAt: Date.now() });
    return NextResponse.json({ message: fallback, cached: false });
  }
}
