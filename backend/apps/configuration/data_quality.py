"""Informe de calidad del dato — Fase 34 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-21). Réplica exacta de `GET
/api/settings/data-quality` (`src/app/api/settings/data-quality/route.ts`):
generado bajo demanda, solo lectura, sin acciones de corrección
automática. Cruza Tareas/Proyectos/Fases/Participantes/Actividades —
ningún modelo nuevo, todos ya portados (Fases 3b/5a-5e)."""

from datetime import timedelta

from apps.projects.models import Project, ProjectActivity, ProjectParticipant, ProjectPhase
from apps.tasks.business_time import business_calendar_day, ranges_overlap
from apps.tasks.models import ActivityReason, Task, TaskActivity

MAX_ITEMS = 20
# Aplica a los chequeos basados en actividades (solapamiento, motivo
# huérfano, retroactivo inconsistente) — acota el volumen de un scan
# completo del historial en un click bajo demanda; los chequeos sobre
# Tarea/Proyecto/Fase (fechas, rango, propietario) sí son sobre la
# tabla completa, ya que ahí el volumen es mucho menor.
ACTIVITY_LOOKBACK_DAYS = 90


def _display_name(user) -> str:
    return user.first_name or user.username


def _build_check(key: str, label: str, items: list[dict], note: str | None = None) -> dict:
    check = {"key": key, "label": label, "count": len(items), "items": items[:MAX_ITEMS]}
    if note:
        check["note"] = note
    return check


def build_data_quality_report(now) -> dict:
    activity_cutoff = now - timedelta(days=ACTIVITY_LOOKBACK_DAYS)

    tasks = list(
        Task.objects.all().only(
            "id", "title", "start_date", "end_date", "progress", "real_hours", "estimated_hours", "assigned_to_id"
        )
    )
    projects = list(Project.objects.all().only("id", "name", "start_date", "target_date", "responsible_id"))
    phases = list(
        ProjectPhase.objects.select_related("project").only(
            "id", "name", "start_date", "target_date", "progress", "project__name"
        )
    )
    participants = list(
        ProjectParticipant.objects.select_related("project").only("id", "user_id", "project__name")
    )
    activity_reason_keys = set(ActivityReason.objects.values_list("key", flat=True))
    task_activities = list(
        TaskActivity.objects.filter(created_at__gte=activity_cutoff)
        .select_related("task", "author")
        .only(
            "id", "author_id", "start_time", "end_time", "created_at", "duration", "reason", "is_retroactive",
            "activity_date", "task__title", "author__first_name", "author__username",
        )
    )
    project_activities = list(
        ProjectActivity.objects.filter(created_at__gte=activity_cutoff)
        .select_related("project", "author")
        .only(
            "id", "author_id", "start_time", "end_time", "created_at", "duration", "is_retroactive",
            "activity_date", "project__name", "author__first_name", "author__username",
        )
    )

    # -- Fechas inválidas -----------------------------------------------------
    invalid_task_dates = [t for t in tasks if t.end_date < t.start_date]
    invalid_project_dates = [p for p in projects if p.target_date < p.start_date]
    invalid_phase_dates = [p for p in phases if p.start_date and p.target_date and p.target_date < p.start_date]

    fechas_invalidas = _build_check(
        "fechas_invalidas",
        "Fechas inválidas (fin anterior a inicio)",
        [
            *({"id": t.id, "label": f'Tarea: "{t.title}"'} for t in invalid_task_dates),
            *({"id": p.id, "label": f'Proyecto: "{p.name}"'} for p in invalid_project_dates),
            *({"id": p.id, "label": f'Fase: "{p.name}" ({p.project.name})'} for p in invalid_phase_dates),
        ],
    )

    # -- Cálculos fuera de rango ------------------------------------------------
    out_of_range_progress = [
        *({"id": t.id, "label": f'Tarea: "{t.title}" (progreso {t.progress}%)'} for t in tasks if t.progress < 0 or t.progress > 100),
        *({"id": p.id, "label": f'Fase: "{p.name}" (progreso {p.progress}%)'} for p in phases if p.progress < 0 or p.progress > 100),
    ]
    negative_hours = [
        *({"id": t.id, "label": f'Tarea: "{t.title}"'} for t in tasks if t.real_hours < 0 or t.estimated_hours < 0),
        *(
            {"id": a.id, "label": f'Actividad de "{a.task.title}" ({_display_name(a.author)})'}
            for a in task_activities if a.duration < 0
        ),
        *(
            {"id": a.id, "label": f'Actividad de "{a.project.name}" ({_display_name(a.author)})'}
            for a in project_activities if a.duration < 0
        ),
    ]
    calculos_fuera_de_rango = _build_check(
        "calculos_fuera_de_rango", "Progreso u horas fuera de rango", [*out_of_range_progress, *negative_hours]
    )

    # -- Sin propietario/responsable/participante ------------------------------
    sin_propietario = _build_check(
        "sin_propietario",
        "Tareas sin propietario / proyectos sin responsable / participantes sin usuario",
        [
            *({"id": t.id, "label": f'Tarea: "{t.title}"'} for t in tasks if not t.assigned_to_id),
            *({"id": p.id, "label": f'Proyecto: "{p.name}"'} for p in projects if not p.responsible_id),
            *(
                {"id": p.id, "label": f'Participante de "{p.project.name}"'}
                for p in participants if not p.user_id
            ),
        ],
    )

    # -- Actividades con motivo huérfano ---------------------------------------
    motivo_huerfano = _build_check(
        "motivo_huerfano",
        f"Actividades con motivo que no existe en el catálogo (últimos {ACTIVITY_LOOKBACK_DAYS} días)",
        [
            {"id": a.id, "label": f'{_display_name(a.author)}: "{a.task.title}" — motivo "{a.reason}"'}
            for a in task_activities
            if a.reason not in activity_reason_keys
        ],
    )

    # -- Registros retroactivos inconsistentes ---------------------------------
    def _retro_inconsistencies(items, label_fn) -> list[dict]:
        out = []
        for a in items:
            if a.is_retroactive and a.activity_date is None:
                out.append({"id": a.id, "label": f"{label_fn(a)} — marcada retroactiva sin fecha"})
            elif (
                not a.is_retroactive
                and a.activity_date is not None
                and business_calendar_day(a.activity_date) != business_calendar_day(a.created_at)
            ):
                out.append({"id": a.id, "label": f"{label_fn(a)} — fecha distinta a su creación, sin marcar como retroactiva"})
        return out

    registros_retroactivos_inconsistentes = _build_check(
        "retroactivo_inconsistente",
        f"Registros retroactivos inconsistentes (últimos {ACTIVITY_LOOKBACK_DAYS} días)",
        [
            *_retro_inconsistencies(
                task_activities, lambda a: f'{_display_name(a.author)}: "{a.task.title}" (Tarea)'
            ),
            *_retro_inconsistencies(
                project_activities, lambda a: f'{_display_name(a.author)}: "{a.project.name}" (Proyecto)'
            ),
        ],
    )

    # -- Horas duplicadas (mismo autor, mismo día, horario solapado) -----------
    candidates = [
        *(
            {
                "id": a.id, "author_id": a.author_id, "start_time": a.start_time, "end_time": a.end_time,
                "day": business_calendar_day(a.created_at),
                "label": f'{_display_name(a.author)}: "{a.task.title}" (Tarea) {a.start_time}-{a.end_time}',
            }
            for a in task_activities if a.start_time is not None and a.end_time is not None
        ),
        *(
            {
                "id": a.id, "author_id": a.author_id, "start_time": a.start_time, "end_time": a.end_time,
                "day": business_calendar_day(a.created_at),
                "label": f'{_display_name(a.author)}: "{a.project.name}" (Proyecto) {a.start_time}-{a.end_time}',
            }
            for a in project_activities if a.start_time is not None and a.end_time is not None
        ),
    ]
    by_author_day: dict[tuple, list[dict]] = {}
    for c in candidates:
        by_author_day.setdefault((c["author_id"], c["day"]), []).append(c)

    overlapping = []
    flagged_ids: set = set()
    for bucket in by_author_day.values():
        if len(bucket) < 2:
            continue
        for i in range(len(bucket)):
            for j in range(i + 1, len(bucket)):
                a, b = bucket[i], bucket[j]
                if ranges_overlap(a["start_time"], a["end_time"], b["start_time"], b["end_time"]):
                    for c in (a, b):
                        if c["id"] not in flagged_ids:
                            flagged_ids.add(c["id"])
                            overlapping.append({"id": c["id"], "label": c["label"]})

    horas_duplicadas = _build_check(
        "horas_duplicadas",
        f"Horas con horario solapado, mismo autor y día (últimos {ACTIVITY_LOOKBACK_DAYS} días)",
        overlapping,
    )

    # -- Registros huérfanos / referencias rotas -------------------------------
    # No se ejecuta ninguna consulta: toda referencia tiene FK real con
    # PROTECT/CASCADE (sin equivalente a un "borrado en cascada hacia
    # arriba" que deje huérfanos) — se reporta como confirmación
    # estructural, no como resultado de una búsqueda.
    registros_huerfanos = _build_check(
        "registros_huerfanos",
        "Registros huérfanos / referencias rotas",
        [],
        "Protegido estructuralmente por restricciones de llave foránea (no se puede crear un huérfano vía el ORM).",
    )

    checks = [
        fechas_invalidas,
        calculos_fuera_de_rango,
        sin_propietario,
        motivo_huerfano,
        registros_retroactivos_inconsistentes,
        horas_duplicadas,
        registros_huerfanos,
    ]

    return {
        "generated_at": now.isoformat(),
        "total_issues": sum(c["count"] for c in checks),
        "checks": checks,
    }
