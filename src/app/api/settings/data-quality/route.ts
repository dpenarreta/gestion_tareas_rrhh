import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { businessCalendarDay } from "@/lib/businessTime";
import { rangesOverlap } from "@/lib/timeOverlap";

// Sprint D (Bloque 9) — informe interno de calidad del dato, generado bajo
// demanda (botón en Ajustes, sin cron), solo lectura, sin acciones de
// corrección automática. Ver docs/AUDIT_LOG.md § Sprint D.

const MAX_ITEMS = 20;
// Aplica a los chequeos basados en actividades (solapamiento, motivo
// huérfano, retroactivo inconsistente) — acota el volumen de un scan
// completo del historial en un click bajo demanda; los chequeos sobre
// Tarea/Proyecto/Fase (fechas, rango, propietario) sí son sobre la tabla
// completa, ya que ahí el volumen es mucho menor.
const ACTIVITY_LOOKBACK_DAYS = 90;

type QualityItem = { id: string; label: string };
type QualityCheck = { key: string; label: string; count: number; items: QualityItem[]; note?: string };

function buildCheck(key: string, label: string, matches: QualityItem[], note?: string): QualityCheck {
  return { key, label, count: matches.length, items: matches.slice(0, MAX_ITEMS), note };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const activityCutoff = new Date(Date.now() - ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [tasks, projects, phases, participants, activityReasons, taskActivities, projectActivities] = await Promise.all([
    prisma.task.findMany({
      select: { id: true, title: true, startDate: true, endDate: true, progress: true, realHours: true, estimatedHours: true, assignedToId: true },
    }),
    prisma.project.findMany({
      select: { id: true, name: true, startDate: true, targetDate: true, responsibleId: true },
    }),
    prisma.projectPhase.findMany({
      select: { id: true, name: true, startDate: true, targetDate: true, progress: true, project: { select: { name: true } } },
    }),
    prisma.projectParticipant.findMany({
      select: { id: true, userId: true, project: { select: { name: true } } },
    }),
    prisma.activityReason.findMany({ select: { key: true } }),
    prisma.taskActivity.findMany({
      where: { createdAt: { gte: activityCutoff } },
      select: {
        id: true,
        authorId: true,
        startTime: true,
        endTime: true,
        createdAt: true,
        duration: true,
        reason: true,
        isRetroactive: true,
        activityDate: true,
        task: { select: { title: true } },
        author: { select: { name: true } },
      },
    }),
    prisma.projectActivity.findMany({
      where: { createdAt: { gte: activityCutoff } },
      select: {
        id: true,
        authorId: true,
        startTime: true,
        endTime: true,
        createdAt: true,
        duration: true,
        isRetroactive: true,
        activityDate: true,
        project: { select: { name: true } },
        author: { select: { name: true } },
      },
    }),
  ]);

  // ── Fechas inválidas ────────────────────────────────────────────────────
  const invalidTaskDates = tasks.filter((t) => t.endDate < t.startDate);
  const invalidProjectDates = projects.filter((p) => p.targetDate < p.startDate);
  const invalidPhaseDates = phases.filter((p) => p.startDate && p.targetDate && p.targetDate < p.startDate);

  const fechasInvalidas = buildCheck(
    "fechas_invalidas",
    "Fechas inválidas (fin anterior a inicio)",
    [
      ...invalidTaskDates.map((t) => ({ id: t.id, label: `Tarea: "${t.title}"` })),
      ...invalidProjectDates.map((p) => ({ id: p.id, label: `Proyecto: "${p.name}"` })),
      ...invalidPhaseDates.map((p) => ({ id: p.id, label: `Fase: "${p.name}" (${p.project.name})` })),
    ]
  );

  // ── Cálculos fuera de rango ─────────────────────────────────────────────
  const outOfRangeProgress = [
    ...tasks.filter((t) => t.progress < 0 || t.progress > 100).map((t) => ({ id: t.id, label: `Tarea: "${t.title}" (progreso ${t.progress}%)` })),
    ...phases.filter((p) => p.progress < 0 || p.progress > 100).map((p) => ({ id: p.id, label: `Fase: "${p.name}" (progreso ${p.progress}%)` })),
  ];
  const negativeHours = [
    ...tasks.filter((t) => t.realHours < 0 || t.estimatedHours < 0).map((t) => ({ id: t.id, label: `Tarea: "${t.title}"` })),
    ...taskActivities.filter((a) => a.duration < 0).map((a) => ({ id: a.id, label: `Actividad de "${a.task.title}" (${a.author.name})` })),
    ...projectActivities.filter((a) => a.duration < 0).map((a) => ({ id: a.id, label: `Actividad de "${a.project.name}" (${a.author.name})` })),
  ];

  const calculosFueraDeRango = buildCheck("calculos_fuera_de_rango", "Progreso u horas fuera de rango", [...outOfRangeProgress, ...negativeHours]);

  // ── Registros sin propietario/responsable/participante (defensivo — todos
  // son campos obligatorios y con FK real en el schema, se espera 0; solo
  // detecta strings vacíos que el schema no impide) ──────────────────────
  const sinPropietario = buildCheck(
    "sin_propietario",
    "Tareas sin propietario / proyectos sin responsable / participantes sin usuario",
    [
      ...tasks.filter((t) => !t.assignedToId).map((t) => ({ id: t.id, label: `Tarea: "${t.title}"` })),
      ...projects.filter((p) => !p.responsibleId).map((p) => ({ id: p.id, label: `Proyecto: "${p.name}"` })),
      ...participants.filter((p) => !p.userId).map((p) => ({ id: p.id, label: `Participante de "${p.project.name}"` })),
    ]
  );

  // ── Actividades con motivo huérfano: TaskActivity.reason es un String
  // libre resuelto por convención contra ActivityReason.key — no es una FK
  // real, así que un motivo eliminado o mal escrito puede quedar "colgado"
  // sin que el schema lo impida. ProjectActivity no tiene campo de motivo.
  const validReasonKeys = new Set(activityReasons.map((r) => r.key));
  const motivoHuerfano = buildCheck(
    "motivo_huerfano",
    `Actividades con motivo que no existe en el catálogo (últimos ${ACTIVITY_LOOKBACK_DAYS} días)`,
    taskActivities
      .filter((a) => !validReasonKeys.has(a.reason))
      .map((a) => ({ id: a.id, label: `${a.author.name}: "${a.task.title}" — motivo "${a.reason}"` }))
  );

  // ── Registros retroactivos inconsistentes: dos chequeos de consistencia
  // interna (no relativos a "hoy", para no generar falsos positivos con
  // datos históricos legítimos que ya no están dentro de ninguna ventana
  // vigente):
  //  1. isRetroactive=true sin activityDate — contradicción, un registro
  //     retroactivo siempre debe traer una fecha explícita.
  //  2. isRetroactive=false pero activityDate cae en un día calendario
  //     distinto al de createdAt — sugiere un registro backdateado a mano
  //     sin marcar el flag.
  type ActivityForRetroCheck = { id: string; isRetroactive: boolean; activityDate: Date | null; createdAt: Date; label: string };
  function retroInconsistencies(items: ActivityForRetroCheck[]): QualityItem[] {
    const out: QualityItem[] = [];
    for (const a of items) {
      if (a.isRetroactive && a.activityDate == null) {
        out.push({ id: a.id, label: `${a.label} — marcada retroactiva sin fecha` });
      } else if (!a.isRetroactive && a.activityDate != null && businessCalendarDay(a.activityDate).getTime() !== businessCalendarDay(a.createdAt).getTime()) {
        out.push({ id: a.id, label: `${a.label} — fecha distinta a su creación, sin marcar como retroactiva` });
      }
    }
    return out;
  }
  const registrosRetroactivosInconsistentes = buildCheck(
    "retroactivo_inconsistente",
    `Registros retroactivos inconsistentes (últimos ${ACTIVITY_LOOKBACK_DAYS} días)`,
    [
      ...retroInconsistencies(
        taskActivities.map((a) => ({ ...a, label: `${a.author.name}: "${a.task.title}" (Tarea)` }))
      ),
      ...retroInconsistencies(
        projectActivities.map((a) => ({ ...a, label: `${a.author.name}: "${a.project.name}" (Proyecto)` }))
      ),
    ]
  );

  // ── Horas duplicadas: actividades del mismo autor con horario solapado el
  // mismo día calendario, cruzando Tareas y Proyectos — el validador en vivo
  // (findOverlappingActivity) solo cubre Tarea↔Tarea, no Tarea↔Proyecto (ver
  // docs/AUDIT_LOG.md § Sprint D, hallazgo diferido a backlog). Este chequeo
  // no corrige nada, solo evidencia si el hueco produjo casos reales. ────────
  type OverlapCandidate = { id: string; authorId: string; startTime: string; endTime: string; day: number; label: string };
  const candidates: OverlapCandidate[] = [
    ...taskActivities
      .filter((a) => a.startTime != null && a.endTime != null)
      .map((a) => ({
        id: a.id,
        authorId: a.authorId,
        startTime: a.startTime!,
        endTime: a.endTime!,
        day: businessCalendarDay(a.createdAt).getTime(),
        label: `${a.author.name}: "${a.task.title}" (Tarea) ${a.startTime}-${a.endTime}`,
      })),
    ...projectActivities
      .filter((a) => a.startTime != null && a.endTime != null)
      .map((a) => ({
        id: a.id,
        authorId: a.authorId,
        startTime: a.startTime!,
        endTime: a.endTime!,
        day: businessCalendarDay(a.createdAt).getTime(),
        label: `${a.author.name}: "${a.project.name}" (Proyecto) ${a.startTime}-${a.endTime}`,
      })),
  ];
  const byAuthorDay = new Map<string, OverlapCandidate[]>();
  for (const c of candidates) {
    const key = `${c.authorId}:${c.day}`;
    const bucket = byAuthorDay.get(key);
    if (bucket) bucket.push(c);
    else byAuthorDay.set(key, [c]);
  }
  const overlapping: QualityItem[] = [];
  const flaggedIds = new Set<string>();
  for (const bucket of byAuthorDay.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (rangesOverlap(bucket[i].startTime, bucket[i].endTime, bucket[j].startTime, bucket[j].endTime)) {
          for (const c of [bucket[i], bucket[j]]) {
            if (!flaggedIds.has(c.id)) {
              flaggedIds.add(c.id);
              overlapping.push({ id: c.id, label: c.label });
            }
          }
        }
      }
    }
  }
  const horasDuplicadas = buildCheck(
    "horas_duplicadas",
    `Horas con horario solapado, mismo autor y día (últimos ${ACTIVITY_LOOKBACK_DAYS} días)`,
    overlapping
  );

  // ── Registros huérfanos / referencias rotas ─────────────────────────────
  // No se ejecuta una consulta: toda referencia (TaskActivity.taskId,
  // ProjectActivity.projectId, Comment.taskId, etc.) tiene una restricción de
  // llave foránea en Postgres sin onDelete en cascada hacia abajo desde el
  // padre requerido — el ORM no permite crear un huérfano. Se reporta como
  // confirmación estructural, no como resultado de una búsqueda.
  const registrosHuerfanos = buildCheck(
    "registros_huerfanos",
    "Registros huérfanos / referencias rotas",
    [],
    "Protegido estructuralmente por restricciones de llave foránea (no se puede crear un huérfano vía el ORM)."
  );

  const checks: QualityCheck[] = [
    fechasInvalidas,
    calculosFueraDeRango,
    sinPropietario,
    motivoHuerfano,
    registrosRetroactivosInconsistentes,
    horasDuplicadas,
    registrosHuerfanos,
  ];

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalIssues: checks.reduce((sum, c) => sum + c.count, 0),
    checks,
  });
}
