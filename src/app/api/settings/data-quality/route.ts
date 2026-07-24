import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { businessCalendarDay } from "@/lib/businessTime";
import { rangesOverlap } from "@/lib/timeOverlap";

// Sprint D (Bloque 9) — informe interno de calidad del dato, generado bajo
// demanda (botón en Ajustes, sin cron), solo lectura, sin acciones de
// corrección automática. Ver docs/AUDIT_LOG.md § Sprint D.

const MAX_ITEMS = 20;
const OVERLAP_LOOKBACK_DAYS = 90;

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

  const overlapCutoff = new Date(Date.now() - OVERLAP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [tasks, projects, phases, taskActivities, projectActivities] = await Promise.all([
    prisma.task.findMany({
      select: { id: true, title: true, startDate: true, endDate: true, progress: true, realHours: true, estimatedHours: true, assignedToId: true },
    }),
    prisma.project.findMany({
      select: { id: true, name: true, startDate: true, targetDate: true, responsibleId: true },
    }),
    prisma.projectPhase.findMany({
      select: { id: true, name: true, startDate: true, targetDate: true, progress: true, project: { select: { name: true } } },
    }),
    prisma.taskActivity.findMany({
      where: { startTime: { not: null }, endTime: { not: null }, createdAt: { gte: overlapCutoff } },
      select: { id: true, authorId: true, startTime: true, endTime: true, createdAt: true, duration: true, task: { select: { title: true } }, author: { select: { name: true } } },
    }),
    prisma.projectActivity.findMany({
      where: { startTime: { not: null }, endTime: { not: null }, createdAt: { gte: overlapCutoff } },
      select: { id: true, authorId: true, startTime: true, endTime: true, createdAt: true, duration: true, project: { select: { name: true } }, author: { select: { name: true } } },
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

  // ── Registros sin propietario/responsable (defensivo — ambos campos son
  // obligatorios en el schema, se espera 0; solo detecta strings vacíos que
  // el schema no impide) ──────────────────────────────────────────────────
  const sinPropietario = buildCheck(
    "sin_propietario",
    "Tareas sin propietario / proyectos sin responsable",
    [
      ...tasks.filter((t) => !t.assignedToId).map((t) => ({ id: t.id, label: `Tarea: "${t.title}"` })),
      ...projects.filter((p) => !p.responsibleId).map((p) => ({ id: p.id, label: `Proyecto: "${p.name}"` })),
    ]
  );

  // ── Horas duplicadas: actividades del mismo autor con horario solapado el
  // mismo día calendario, cruzando Tareas y Proyectos — el validador en vivo
  // (findOverlappingActivity) solo cubre Tarea↔Tarea, no Tarea↔Proyecto (ver
  // docs/AUDIT_LOG.md § Sprint D, hallazgo diferido a backlog). Este chequeo
  // no corrige nada, solo evidencia si el hueco produjo casos reales. ────────
  type OverlapCandidate = { id: string; authorId: string; startTime: string; endTime: string; day: number; label: string };
  const candidates: OverlapCandidate[] = [
    ...taskActivities.map((a) => ({
      id: a.id,
      authorId: a.authorId,
      startTime: a.startTime!,
      endTime: a.endTime!,
      day: businessCalendarDay(a.createdAt).getTime(),
      label: `${a.author.name}: "${a.task.title}" (Tarea) ${a.startTime}-${a.endTime}`,
    })),
    ...projectActivities.map((a) => ({
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
    `Horas con horario solapado, mismo autor y día (últimos ${OVERLAP_LOOKBACK_DAYS} días)`,
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

  const checks: QualityCheck[] = [fechasInvalidas, calculosFueraDeRango, sinPropietario, horasDuplicadas, registrosHuerfanos];

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalIssues: checks.reduce((sum, c) => sum + c.count, 0),
    checks,
  });
}
