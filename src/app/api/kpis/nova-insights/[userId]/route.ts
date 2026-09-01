import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSession } from "@/lib/session";
import { ROLE_LEVEL, ROLE_LABEL, canViewOperationalRisk } from "@/lib/roles";
import { djangoApiFetch, resolveDjangoUserId, ANALYTICS_BUNDLE_TIMEOUT_MS } from "@/lib/djangoSession";
import { fetchDjangoNovaCacheTtlMinutes } from "@/lib/djangoNovaCacheConfig";
import { mapDjangoAnalyticsPayloadToNexoShape } from "@/lib/djangoAnalyticsAdapter";
import { mapDjangoKpiPayloadToNexoShape } from "@/lib/djangoKpisAdapter";
import type { Role } from "@/lib/roles";

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
// generaciones de Gemini DISTINTAS, nunca deben compartir entrada (ver
// `sensitivity` más abajo: evita que un dato de salud generado para el propio
// titular/Administrador se filtre a un viewer sin privilegio, dado que esta
// caché no está aislada por viewer).
const analyticalCache = new Map<string, AnalyticalCacheEntry>();
const motivationalCache = new Map<string, MotivationalCacheEntry>();

// Lazy, mismo patrón defensivo que el resto de las rutas de Nova — el SDK de
// Gemini (a diferencia de `groq-sdk`) no lanza síncronamente si falta la key,
// pero construirlo perezosamente sigue evitando trabajo innecesario cuando
// el guard `if (process.env.GEMINI_API_KEY)` de abajo ya cortó el flujo.
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return geminiClient;
}

// Gemini NUNCA calcula nada — todo el JSON que recibe ya viene calculado
// deterministicamente por el motor de Analytics (Django, `apps.analytics`,
// ver Analytics § Nova — solo lenguaje natural). Su única función es
// explicar, priorizar y recomendar en español a partir de datos ya
// resueltos; nunca debe inventar cifras que no estén en el JSON recibido.
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

// ── Fallbacks deterministas (sin Gemini / si la llamada falla) — SIEMPRE a partir de datos ya calculados, nunca inventados ──

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

/** Extrae el primer objeto JSON `{...}` de un texto (aunque se pide `responseMimeType: "application/json"`, se mantiene como red de seguridad por si el modelo envuelve la respuesta en markdown). */
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

// ── Puente a Django (ver docs/AUDIT_LOG.md § 2026-08-24) ──────────────────

const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

/** Señaliza un fallo de Django hacia el `GET` exterior sin ensuciar la lógica
 * de generación con chequeos de status en cada llamada — mismo criterio de
 * status codes que el resto de las rutas `analytics/*`/`kpis/*` ya cortadas
 * (401 sin sesión Django, 404/403 propagados, resto como error genérico). */
class DjangoUnavailable extends Error {
  constructor(readonly response: NextResponse) {
    super("django-unavailable");
  }
}

// Django devuelve todo en snake_case — `mapper` es OBLIGATORIO (no un
// default silencioso) para forzar a cada call site a declarar
// explícitamente con qué adaptador corresponde traducirlo, mismo criterio
// que ya usan `/api/analytics/[userId]`/`/api/kpis/[userId]`/
// `/api/analytics/operational-risk/[userId]` (ya cortados). Bug encontrado
// en QA en vivo (2026-08-31): esta ruta nunca aplicaba ningún adaptador —
// `bundle.healthScore`/`kpi.cargaTiempo`/etc. eran siempre `undefined`
// (el campo real es `health_score`/`carga_tiempo`), rompiendo con un
// `TypeError` en CUALQUIER request real desde el cutover a Django, nunca
// detectado porque los tests mockean `djangoApiFetch` con fixtures ya en
// camelCase.
async function fetchDjangoJson<T>(path: string, mapper: (raw: Record<string, unknown>) => unknown, timeoutMs?: number): Promise<T> {
  let response;
  try {
    response = await djangoApiFetch(path, {}, timeoutMs);
  } catch {
    // Timeout (`AbortSignal`) u otro fallo de red — ver `ANALYTICS_BUNDLE_TIMEOUT_MS`
    // en djangoSession.ts. Antes de este fix, un `AbortError` acá escapaba
    // sin traducir hasta el `GET` exterior, terminando en un 500 vacío.
    throw new DjangoUnavailable(
      NextResponse.json({ error: "El cálculo de Insights está tardando más de lo esperado. Intenta de nuevo en unos segundos." }, { status: 504 })
    );
  }
  if (!response) {
    throw new DjangoUnavailable(NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 }));
  }
  if (response.status === 404) {
    throw new DjangoUnavailable(NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 }));
  }
  if (response.status === 403) {
    throw new DjangoUnavailable(NextResponse.json({ error: "Sin permisos" }, { status: 403 }));
  }
  if (!response.ok) {
    throw new DjangoUnavailable(NextResponse.json({ error: "Error al obtener Insights de Nova" }, { status: response.status }));
  }
  return mapper((await response.json()) as Record<string, unknown>) as T;
}

type AnalyticsBundle = {
  healthScore: { score: number; classification: string; factors: { name: string; detail: string; rawLabel: string }[] };
  alerts: { severity: string; message: string }[];
  trends: {
    cumplimiento: { mesAnterior: { available: boolean; direction?: string; absoluteDiff?: number }; promedio6Meses: unknown };
    carga: { mesAnterior: unknown };
  };
  consistency: unknown;
  anomalies: unknown;
  prediction: unknown;
  dataQuality: unknown;
};

type KpiUserPayload = {
  user: { id: string; name: string; role: string };
  cargaTiempo: { mensual: { specialStatusType: string | null } };
};

type OperationalRiskPayload = {
  score: number;
  classification: string;
  trendVsPrevMonth: unknown;
  factors: { points: number; detail: string }[];
  suggestedActions: string[];
};

async function generateAnalytical(userId: string, sensitivity: Sensitivity, canSeeRisk: boolean): Promise<AnalyticalCacheEntry> {
  // El bundle (`GET /analytics/<id>/`, Fase 4m) trae Equilibrio Operativo/
  // alertas/tendencias/consistencia/anomalías/predicción/calidad del dato en
  // una sola llamada — Riesgo Operativo no forma parte del bundle (motor
  // aparte) y `/kpis/<id>/` es la única fuente ya expuesta para nombre/rol
  // del colaborador y el estado especial vigente del mes.
  const bundle = await fetchDjangoJson<AnalyticsBundle>(`/analytics/${userId}/`, mapDjangoAnalyticsPayloadToNexoShape, ANALYTICS_BUNDLE_TIMEOUT_MS);
  const [kpi, operationalRisk] = await Promise.all([
    fetchDjangoJson<KpiUserPayload>(`/kpis/${userId}/`, mapDjangoKpiPayloadToNexoShape),
    canSeeRisk ? fetchDjangoJson<OperationalRiskPayload>(`/analytics/operational-risk/${userId}/`, mapDjangoAnalyticsPayloadToNexoShape) : Promise.resolve(null),
  ]);

  const { healthScore, alerts, trends, consistency, anomalies, prediction, dataQuality } = bundle;

  const especial =
    sensitivity === "full" && kpi.cargaTiempo.mensual.specialStatusType
      ? kpi.cargaTiempo.mensual.specialStatusType === "MATERNIDAD"
        ? "Licencia de maternidad vigente este mes"
        : "Período de lactancia vigente este mes"
      : null;

  // Todo lo que recibe Gemini ya viene calculado por el motor de Analytics —
  // ver Analytics § Nova solo lenguaje natural. Ningún campo aquí es un
  // cálculo hecho en esta ruta; son lecturas directas del motor.
  const ctx = {
    nombre: kpi.user.name,
    rol: ROLE_LABEL[kpi.user.role as Role] ?? kpi.user.role,
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
  if (process.env.GEMINI_API_KEY) {
    try {
      const completion = await getGeminiClient().models.generateContent({
        model: "gemini-3.6-flash",
        contents: [{ role: "user", parts: [{ text: JSON.stringify(ctx) }] }],
        config: {
          systemInstruction: ANALYTICAL_SYSTEM_PROMPT,
          // `gemini-3.6-flash` consume tokens de "thinking" del MISMO
          // presupuesto que `maxOutputTokens`, sin poder desactivarse (ver
          // `ANALYTICAL_SYSTEM_PROMPT` arriba, respuesta JSON con 4 campos).
          maxOutputTokens: 2048,
          temperature: 0.4,
          responseMimeType: "application/json",
        },
      });
      const parsed = extractJson(completion.text ?? "") as
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

  const cacheTtlMs = (await fetchDjangoNovaCacheTtlMinutes()) * 60 * 1000;
  return { hallazgoPrincipal, riesgos, aspectosPositivos, recomendaciones, generatedAt: Date.now(), expiresAt: Date.now() + cacheTtlMs };
}

async function generateMotivational(userId: string, selfName: string): Promise<MotivationalCacheEntry> {
  // Solo se llama cuando `isSelf` es verdadero (ver GET) — el nombre viene
  // de la propia sesión, sin necesidad de una llamada extra a `/kpis/<id>/`
  // solo para leerlo.
  const bundle = await fetchDjangoJson<AnalyticsBundle>(`/analytics/${userId}/`, mapDjangoAnalyticsPayloadToNexoShape, ANALYTICS_BUNDLE_TIMEOUT_MS);
  const { healthScore } = bundle;
  const completedFactor = healthScore.factors.find((f) => f.name === "Cumplimiento");
  const completedPct = completedFactor ? parseInt(completedFactor.rawLabel, 10) || 0 : 0;

  const ctx = {
    nombre: selfName,
    equilibrioOperativo: { valor: healthScore.score, clasificacion: healthScore.classification },
    cumplimientoPct: completedPct,
  };

  let messages: string[] = [];
  if (process.env.GEMINI_API_KEY) {
    try {
      const completion = await getGeminiClient().models.generateContent({
        model: "gemini-3.6-flash",
        contents: [{ role: "user", parts: [{ text: JSON.stringify(ctx) }] }],
        config: {
          systemInstruction: MOTIVATIONAL_SYSTEM_PROMPT,
          // `gemini-3.6-flash` consume tokens de "thinking" del MISMO
          // presupuesto que `maxOutputTokens`, sin poder desactivarse.
          maxOutputTokens: 1536,
          temperature: 0.6,
          responseMimeType: "application/json",
        },
      });
      const parsed = extractJson(completion.text ?? "") as { messages?: unknown } | null;
      messages = asStringArray(parsed?.messages);
    } catch {
      messages = [];
    }
  }
  if (messages.length === 0) {
    messages = fallbackMotivational({ completedPct, totalTasks: 1 });
  }

  const cacheTtlMs = (await fetchDjangoNovaCacheTtlMinutes()) * 60 * 1000;
  return { messages, generatedAt: Date.now(), expiresAt: Date.now() + cacheTtlMs };
}

type Ctx = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { userId } = await ctx.params;

  // `userId` (parámetro de ruta) siempre es el id NUMÉRICO de Django (mismo
  // contrato que el resto de `analytics/*`/`kpis/*` ya cortados) — "es mi
  // propio perfil" se decide contra `resolveDjangoUserId`.
  const myDjangoId = await resolveDjangoUserId(session);
  const isSelf = myDjangoId !== null && String(myDjangoId) === userId;
  const viewerLevel = ROLE_LEVEL[session.role];

  // VISIBILIDAD (ver Analytics § Componente 4 — motor de recomendaciones Nova):
  // - Administrador / Jefe Nacional / Coordinador Nacional (nivel >= 3): análisis completo (las 4 secciones).
  // - Analistas nivel 2: solo hallazgo principal y aspectos positivos (sin riesgos ni recomendaciones).
  // - Nivel 1 viendo su propia actividad: versión simplificada y motivacional.
  // La visibilidad jerárquica real sobre el usuario objetivo (404/403 al ver
  // a un tercero fuera de alcance) vive en `AnalyticsBundleView`/
  // `KpiUserView` (backend) — no se re-implementa acá, mismo criterio que el
  // resto de `analytics/*` ya cortadas.
  const mode: Mode = isSelf && viewerLevel === 1 ? "motivational" : viewerLevel >= 3 ? "full" : "insights-only";

  // Los permisos médicos y el estado de maternidad/lactancia son datos de
  // salud (Art. 26 LOPDP) — solo el propio titular y el Administrador pueden
  // recibir contenido generado a partir de ese detalle (mismo criterio que
  // `redactSensitiveWorkloadDetail`/`can_see_sensitive_detail` en el backend).
  const sensitivity: Sensitivity = isSelf || session.role === "ADMINISTRADOR" ? "full" : "restricted";
  const canSeeRisk = canViewOperationalRisk(session.role);

  try {
    if (mode === "motivational") {
      const cacheKey = `${userId}:motivational`;
      const cached = motivationalCache.get(cacheKey);
      const entry = cached && cached.expiresAt > Date.now() ? cached : await generateMotivational(userId, session.name);
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
  } catch (err) {
    if (err instanceof DjangoUnavailable) return err.response;
    // Cualquier otro error (parseo/forma inesperada de los datos, etc.) —
    // antes de este fix escapaba sin traducir y Next.js devolvía un 500 con
    // el body vacío (ver bug de timeout arriba, mismo síntoma con otra
    // causa): se loguea server-side y se responde JSON legible en vez de
    // dejarlo propagar.
    console.error("[nova-insights] Error inesperado:", err);
    return NextResponse.json({ error: "Error al generar Insights de Nova" }, { status: 500 });
  }
}
