import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getVisibleRoles, ROLE_LEVEL, ROLE_LABEL, canViewOperationalRisk } from "@/lib/roles";
import { computeCargaTiempo } from "@/lib/workload";
import {
  computeHealthScore,
  computeOperationalRisk,
  computeAlerts,
  computeTrends,
  computeConsistency,
  detectAnomalies,
  computePrediction,
  computeDataQuality,
} from "@/lib/analytics";
import type { Role } from "@/generated/prisma/client";

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas — caché de la GENERACIÓN de Groq (más larga que la caché de cálculo de analytics.ts: es una llamada a IA, no una consulta a BD).

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

// Cache en memoria por colaborador + variante generada — "full"/"restricted"
// (¿incluye detalle de salud del estado especial?) y "motivational" son
// generaciones de Groq DISTINTAS, nunca deben compartir entrada (ver
// `sensitivity` más abajo: evita que un dato de salud generado para el propio
// titular/Administrador se filtre a un viewer sin privilegio, dado que esta
// caché no está aislada por viewer).
const analyticalCache = new Map<string, AnalyticalCacheEntry>();
const motivationalCache = new Map<string, MotivationalCacheEntry>();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Groq NUNCA calcula nada — todo el JSON que recibe ya viene calculado
// deterministicamente por src/lib/analytics.ts (ver Analytics § Nova — solo
// lenguaje natural). Su única función es explicar, priorizar y recomendar en
// español a partir de datos ya resueltos; nunca debe inventar cifras que no
// estén en el JSON recibido.
const ANALYTICAL_SYSTEM_PROMPT =
  "Eres un analista de People Analytics. Recibirás un JSON con datos YA CALCULADOS por un motor determinístico " +
  "(nunca los calcules tú, ni los cuestiones ni los recalcules). Tu única función es explicar esos datos en " +
  "lenguaje natural e identificar los puntos más importantes. NUNCA inventes datos que no estén en el JSON. " +
  "NUNCA suavices resultados negativos — sé directo y objetivo. Si un dato no está en el JSON recibido, no lo " +
  'menciones. Responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional ni markdown, con esta ' +
  'forma exacta: {"hallazgoPrincipal": string, "riesgos": string[], "aspectosPositivos": string[], ' +
  '"recomendaciones": string[]}, usando exactamente este criterio por campo: ' +
  "hallazgoPrincipal = el dato más importante del período, con al menos un número. " +
  "riesgos = entre 1 y 3 riesgos detectados con datos específicos; si no hay riesgos, un único ítem indicándolo " +
  "explícitamente (nunca un array vacío). " +
  "aspectosPositivos = entre 1 y 2 aspectos positivos con números; si no los hay, un único ítem indicándolo " +
  "explícitamente (nunca un array vacío). " +
  "recomendaciones = entre 1 y 2 acciones concretas y priorizadas, con plazo (qué hacer, cuándo) — nunca genéricas.";

const MOTIVATIONAL_SYSTEM_PROMPT =
  "Eres Nova, la asistente de People Analytics de Nexo. Recibirás un JSON con datos YA CALCULADOS (nunca los " +
  "calcules ni los inventes) sobre el desempeño de un colaborador. Genera un mensaje breve, cercano y " +
  "motivador sobre su propio desempeño, en tono cálido y de apoyo, en español simple, sin tecnicismos de RRHH. " +
  "Si hay algo que mejorar, menciónalo con delicadeza y de forma constructiva — nunca alarmante. Responde " +
  'EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional ni markdown, con esta forma exacta: ' +
  '{"messages": string[]}, con entre 2 y 3 mensajes cortos (una frase natural cada uno, sin viñetas).';

// ── Fallbacks deterministas (sin Groq / si la llamada falla) — SIEMPRE a partir de datos ya calculados, nunca inventados ──

function fallbackAnalytical(ctx: {
  hallazgoPrincipal: string;
  riesgosRaw: string[];
  positivosRaw: string[];
  recomendacionesRaw: string[];
}): { hallazgoPrincipal: string; riesgos: string[]; aspectosPositivos: string[]; recomendaciones: string[] } {
  return {
    hallazgoPrincipal: ctx.hallazgoPrincipal,
    riesgos: ctx.riesgosRaw.length > 0 ? ctx.riesgosRaw : ["Sin riesgos detectados en este período."],
    aspectosPositivos: ctx.positivosRaw.length > 0 ? ctx.positivosRaw : ["Sin aspectos destacables este período."],
    recomendaciones: ctx.recomendacionesRaw.length > 0 ? ctx.recomendacionesRaw : ["Sin acciones urgentes — mantener el seguimiento habitual."],
  };
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

async function generateAnalytical(userId: string, sensitivity: Sensitivity, canSeeRisk: boolean): Promise<AnalyticalCacheEntry> {
  const [targetUser, healthScore, alerts, trends, consistency, anomalies, prediction, dataQuality, cargaTiempo, operationalRisk] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } }),
    computeHealthScore(userId),
    computeAlerts(userId),
    computeTrends(userId),
    computeConsistency(userId),
    detectAnomalies(userId),
    computePrediction(userId),
    computeDataQuality([userId]),
    computeCargaTiempo(userId),
    canSeeRisk ? computeOperationalRisk(userId) : Promise.resolve(null),
  ]);

  const especial =
    sensitivity === "full" && cargaTiempo.mensual.specialStatusType
      ? cargaTiempo.mensual.specialStatusType === "MATERNIDAD"
        ? "Licencia de maternidad vigente este mes"
        : "Período de lactancia vigente este mes"
      : null;

  // Todo lo que recibe Groq ya viene calculado por src/lib/analytics.ts — ver
  // Analytics § Nova solo lenguaje natural. Ningún campo aquí es un cálculo
  // hecho en esta ruta; son lecturas directas del motor.
  const ctx = {
    nombre: targetUser?.name ?? "Colaborador",
    rol: targetUser ? (ROLE_LABEL[targetUser.role as Role] ?? targetUser.role) : "",
    equilibrioOperativo: {
      valor: healthScore.score,
      clasificacion: healthScore.classification,
      factores: healthScore.factors.map((f) => ({ nombre: f.name, detalle: f.detail })),
    },
    riesgoOperativo: operationalRisk
      ? {
          valor: operationalRisk.score,
          clasificacion: operationalRisk.classification,
          tendenciaVsMesAnterior: operationalRisk.trendVsPrevMonth,
          factoresConImpacto: operationalRisk.factors.filter((f) => f.points > 0).map((f) => f.detail),
        }
      : undefined,
    alertasActivas: alerts.map((a) => ({ severidad: a.severity, mensaje: a.message })),
    tendencias: {
      cumplimientoVsMesAnterior: trends.cumplimiento.mesAnterior,
      cumplimientoVsPromedio6Meses: trends.cumplimiento.promedio6Meses,
      cargaVsMesAnterior: trends.carga.mesAnterior,
    },
    consistencia: consistency,
    anomaliasDetectadas: anomalies,
    prediccion: prediction,
    calidadDeLosDatos: dataQuality,
    estadoEspecial: especial,
  };

  const riesgosRaw = alerts.filter((a) => a.severity === "red" || a.severity === "orange").map((a) => a.message);
  const positivosRaw: string[] = [];
  if (healthScore.classification === "Excelente" || healthScore.classification === "Bueno") {
    positivosRaw.push(`Equilibrio Operativo: ${healthScore.score}/100 (${healthScore.classification}).`);
  }
  if (trends.cumplimiento.mesAnterior.available && trends.cumplimiento.mesAnterior.direction === "mejora") {
    positivosRaw.push(`Cumplimiento mejoró ${trends.cumplimiento.mesAnterior.absoluteDiff}pp vs. el mes anterior.`);
  }
  const recomendacionesRaw = operationalRisk?.suggestedActions ?? [];

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
      hallazgoPrincipal: `Equilibrio Operativo: ${healthScore.score}/100 (${healthScore.classification}), cumplimiento del ${healthScore.factors.find((f) => f.name === "Cumplimiento")?.rawLabel ?? "—"}.`,
      riesgosRaw,
      positivosRaw,
      recomendacionesRaw,
    });
    if (!hallazgoPrincipal) hallazgoPrincipal = fb.hallazgoPrincipal;
    if (riesgos.length === 0) riesgos = fb.riesgos;
    if (aspectosPositivos.length === 0) aspectosPositivos = fb.aspectosPositivos;
    if (recomendaciones.length === 0) recomendaciones = fb.recomendaciones;
  }

  return { hallazgoPrincipal, riesgos, aspectosPositivos, recomendaciones, generatedAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS };
}

async function generateMotivational(userId: string): Promise<MotivationalCacheEntry> {
  const [targetUser, healthScore] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    computeHealthScore(userId),
  ]);
  const completedFactor = healthScore.factors.find((f) => f.name === "Cumplimiento");
  const completedPct = completedFactor ? parseInt(completedFactor.rawLabel, 10) || 0 : 0;

  const ctx = {
    nombre: targetUser?.name ?? "Colaborador",
    equilibrioOperativo: { valor: healthScore.score, clasificacion: healthScore.classification },
    cumplimientoPct: completedPct,
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
    messages = fallbackMotivational({ completedPct, totalTasks: 1 });
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
  const canSeeRisk = canViewOperationalRisk(session.role);

  if (mode === "motivational") {
    const cacheKey = `${userId}:motivational`;
    const cached = motivationalCache.get(cacheKey);
    const entry = cached && cached.expiresAt > Date.now() ? cached : await generateMotivational(userId);
    if (!cached || cached.expiresAt <= Date.now()) motivationalCache.set(cacheKey, entry);
    return NextResponse.json({ mode, messages: entry.messages, generatedAt: entry.generatedAt });
  }

  const cacheKey = `${userId}:${sensitivity}:${canSeeRisk ? "risk" : "norisk"}`;
  const cached = analyticalCache.get(cacheKey);
  const entry = cached && cached.expiresAt > Date.now() ? cached : await generateAnalytical(userId, sensitivity, canSeeRisk);
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
