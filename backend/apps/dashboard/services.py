"""Orquestación del Dashboard — Fase 25 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-20). Réplica exacta de `GET
/api/dashboard` (`src/app/api/dashboard/route.ts`), ensamblada sobre
motor YA portado (Analytics/Ideas/Anuncios/Configuración) — sin motor
nuevo, sin cutover de Next.js todavía. `nova-message` (asistente
Nova/Groq, LLM-RAG nunca portado) queda explícitamente FUERA de
alcance de esta fase."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.db.models import Q

from apps.analytics.history import compute_monthly_history
from apps.analytics.utils import is_task_overdue
from apps.analytics.workload import (
    compute_carga_tiempo,
    compute_workload_range,
    monthly_business_base_for_users,
)
from apps.announcements.services import list_active_announcements
from apps.configuration.services import (
    get_effective_welcome_message,
    get_effective_welcome_message_active,
)
from apps.core.rounding import round_half_up
from apps.hierarchy.services import get_visible_groups, is_executor_group, role_level
from apps.ideas.models import ImprovementIdea
from apps.ideas.services import get_visible_idea_author_ids
from apps.meetings.models import Meeting
from apps.projects.models import Project
from apps.tasks.business_time import business_day_real_range
from apps.tasks.models import Comment, Task, TaskActivity
from apps.tasks.services import get_activity_reason_label_map
from apps.users.models import User


def _month_bounds(now: datetime) -> tuple[datetime, datetime]:
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_year, next_month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    end = datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc) - timedelta(milliseconds=1)
    return start, end


def _day_bounds(now: datetime) -> tuple[datetime, datetime]:
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = now.replace(hour=23, minute=59, second=59, microsecond=999000)
    return start, end


def _week_bounds(now: datetime) -> tuple[datetime, datetime]:
    """Lunes a domingo — réplica de `weekBounds`. `datetime.weekday()`
    (lunes=0..domingo=6) da directamente el offset que la fórmula TS
    calcula a mano (`getDay()===0 ? -6 : 1`)."""
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = (start + timedelta(days=6)).replace(hour=23, minute=59, second=59, microsecond=999000)
    return start, end


def _task_stats_for_range(tasks: list[Task], start: datetime, end: datetime) -> dict:
    in_range = [t for t in tasks if start <= t.end_date <= end]
    return {
        "pending": sum(1 for t in in_range if t.status == Task.Status.PENDIENTE),
        "inProgress": sum(1 for t in in_range if t.status == Task.Status.EN_PROGRESO),
        "completed": sum(1 for t in in_range if t.status == Task.Status.COMPLETADA),
    }


def _display_name(user) -> str:
    return user.first_name or user.username


def build_dashboard_payload(*, user, now: datetime) -> dict:
    month_start, month_end = _month_bounds(now)
    today_start, today_end = _day_bounds(now)
    week_start, week_end = _week_bounds(now)
    tomorrow = now + timedelta(days=1)
    day_after_tomorrow = tomorrow + timedelta(days=1)
    next_sunday = week_end

    visible_groups = get_visible_groups(user)

    all_my_tasks = list(
        Task.objects.filter(assigned_to=user, archived_month__isnull=True)
        .only("id", "title", "status", "end_date", "estimated_hours", "real_hours")
        .order_by("end_date")
    )
    carga_tiempo = compute_carga_tiempo(user=user, now=now)
    monthly_history = compute_monthly_history(user=user, months_back=1, now=now)
    visible_users = list(
        User.objects.filter(groups__in=visible_groups)
        .exclude(pk=user.id)
        .distinct()
        .only("id", "first_name", "username")
        .prefetch_related("groups")
    )
    announcements = list(list_active_announcements())
    upcoming_meetings = list(
        Meeting.objects.filter(meeting_date__gte=now)
        .filter(Q(host=user) | Q(invitees__user=user))
        .distinct()
        .select_related("host")
        .order_by("meeting_date")[:5]
    )
    welcome_message = get_effective_welcome_message(now)
    welcome_message_active = get_effective_welcome_message_active(now)
    my_projects = list(
        Project.objects.filter(deleted_at__isnull=True)
        .exclude(status__in=[Project.Status.COMPLETADO, Project.Status.CANCELADO])
        .filter(Q(responsible=user) | Q(created_by=user) | Q(participants__user=user))
        .distinct()
        .order_by("target_date")[:5]
    )
    idea_visible_ids_raw = list(get_visible_idea_author_ids(user).values_list("id", flat=True))

    priority_tasks = []
    for t in all_my_tasks:
        if t.status == Task.Status.COMPLETADA:
            continue
        if is_task_overdue(t.end_date, t.status, now):
            urgency = 4
        elif t.end_date <= today_end:
            urgency = 3
        elif t.end_date <= day_after_tomorrow:
            urgency = 2
        elif t.end_date <= next_sunday:
            urgency = 1
        else:
            urgency = 0
        if urgency > 0:
            priority_tasks.append((urgency, t))
    priority_tasks.sort(key=lambda pair: pair[0], reverse=True)
    priority_tasks = [
        {"id": t.id, "title": t.title, "status": t.status, "endDate": t.end_date.isoformat(), "urgency": urgency}
        for urgency, t in priority_tasks[:5]
    ]

    stats_today = _task_stats_for_range(all_my_tasks, today_start, today_end)
    stats_week = _task_stats_for_range(all_my_tasks, week_start, week_end)
    stats_month = _task_stats_for_range(all_my_tasks, month_start, month_end)

    workload_pct = carga_tiempo["mensual"]["pct"]
    completed_pct = monthly_history[-1]["completed_pct"]

    overdue = sum(1 for t in all_my_tasks if is_task_overdue(t.end_date, t.status, now))

    since = user.last_login or (now - timedelta(days=7))
    visible_ids = [u.id for u in visible_users]
    name_map = {u.id: _display_name(u) for u in visible_users}
    member_own_group = {u.id: (list(u.groups.all()) or [None])[0] for u in visible_users}
    executor_ids = [u.id for u in visible_users if is_executor_group(member_own_group[u.id])]

    activity_events: list[dict] = []

    if visible_ids:
        activity_reason_label_map = get_activity_reason_label_map()
        recent_comments = (
            Comment.objects.filter(author_id__in=visible_ids, created_at__gte=since)
            .select_related("task")
            .only("author_id", "task__title", "created_at")
            .order_by("-created_at")[:20]
        )
        recent_activities = (
            TaskActivity.objects.filter(author_id__in=visible_ids, created_at__gte=since)
            .only("author_id", "reason", "created_at")
            .order_by("-created_at")[:20]
        )
        recent_completions = (
            Task.objects.filter(assigned_to_id__in=visible_ids, status=Task.Status.COMPLETADA, updated_at__gte=since)
            .only("assigned_to_id", "title", "updated_at")
            .order_by("-updated_at")[:10]
        )
        recent_assignments = (
            Task.objects.filter(assigned_to_id__in=visible_ids, created_at__gte=since)
            .only("assigned_to_id", "title", "created_at")
            .order_by("-created_at")[:10]
        )

        for c in recent_comments:
            activity_events.append(
                {"time": c.created_at, "text": f'{name_map[c.author_id]} comentó en "{c.task.title}"'}
            )
        for a in recent_activities:
            label = (activity_reason_label_map.get(a.reason) or a.reason).lower()
            activity_events.append(
                {"time": a.created_at, "text": f"{name_map[a.author_id]} registró actividad de {label}"}
            )
        for t in recent_completions:
            activity_events.append(
                {"time": t.updated_at, "text": f'{name_map[t.assigned_to_id]} completó "{t.title}"'}
            )
        for t in recent_assignments:
            activity_events.append(
                {"time": t.created_at, "text": f'{name_map[t.assigned_to_id]} fue asignado a "{t.title}"'}
            )

    idea_visible_ids = [i for i in idea_visible_ids_raw if i != user.id]

    if idea_visible_ids:
        recent_ideas = (
            ImprovementIdea.objects.filter(author_id__in=idea_visible_ids, created_at__gte=since)
            .only("author_id", "title", "created_at")
            .order_by("-created_at")[:10]
        )
        recent_implemented = (
            ImprovementIdea.objects.filter(
                author_id__in=idea_visible_ids, status=ImprovementIdea.Status.IMPLEMENTADA, updated_at__gte=since
            )
            .only("author_id", "title", "updated_at")
            .order_by("-updated_at")[:10]
        )
        for i in recent_ideas:
            activity_events.append(
                {"time": i.created_at, "text": f'{name_map[i.author_id]} propuso la idea "{i.title}"'}
            )
        for i in recent_implemented:
            activity_events.append(
                {"time": i.updated_at, "text": f'{name_map[i.author_id]} implementó la idea "{i.title}"'}
            )

    activity_events.sort(key=lambda e: e["time"], reverse=True)
    area_activity = [{"text": e["text"], "time": e["time"].isoformat()} for e in activity_events[:5]]

    team_alerts = 0
    if role_level(user) >= 2 and executor_ids:
        executor_users = [u for u in visible_users if u.id in executor_ids]
        biz = monthly_business_base_for_users(executor_users, now.year, now.month)
        shared, per_user = biz["shared"], biz["per_user"]
        real_start, _ = business_day_real_range(shared["start"])
        _, real_end = business_day_real_range(shared["end"])
        fija_tasks_for_carga = list(
            Task.objects.filter(
                assigned_to_id__in=executor_ids, type=Task.Type.FIJA, archived_month__isnull=True,
                completed_at__gte=real_start, completed_at__lte=real_end,
            ).only("assigned_to_id", "real_hours")
        )
        activities_for_carga = list(
            TaskActivity.objects.filter(author_id__in=executor_ids, created_at__gte=real_start, created_at__lte=real_end)
            .only("author_id", "duration")
        )
        for uid in executor_ids:
            fija_hours = sum(t.real_hours for t in fija_tasks_for_carga if t.assigned_to_id == uid)
            activity_hours = sum(a.duration for a in activities_for_carga if a.author_id == uid) / 60
            carga_real_hours = round_half_up((fija_hours + activity_hours) * 100) / 100
            user_biz = per_user.get(uid, shared)
            range_ = compute_workload_range(
                carga_real_hours, user_biz["limit_base_hours"], user_biz["limit_low_hours"],
                user_biz["limit_high_hours"], user_biz["limit_overload_hours"],
            )
            if range_["label"] in ("Carga elevada", "Sobrecarga"):
                team_alerts += 1

    return {
        "workloadPct": workload_pct,
        "completedPct": completed_pct,
        "overdue": overdue,
        "priorityTasks": priority_tasks,
        "stats": {"today": stats_today, "week": stats_week, "month": stats_month},
        "areaActivity": area_activity,
        "teamAlerts": team_alerts,
        "welcomeMessage": welcome_message,
        "welcomeMessageActive": welcome_message_active,
        "announcements": [
            {
                "id": a.id,
                "title": a.title,
                "content": a.content,
                "pinned": a.pinned,
                "expiresAt": a.expires_at.isoformat(),
                "createdAt": a.created_at.isoformat(),
                "authorName": _display_name(a.author),
            }
            for a in announcements
        ],
        "lastLoginAt": user.last_login.isoformat() if user.last_login else None,
        "badges": user.badges or [],
        "upcomingMeetings": [
            {
                "id": m.id,
                "title": m.title,
                "meetingDate": m.meeting_date.isoformat(),
                "duration": m.duration,
                "status": m.status,
                "hostName": _display_name(m.host),
            }
            for m in upcoming_meetings
        ],
        "myProjects": [
            {
                "id": p.id,
                "name": p.name,
                "status": p.status,
                "priority": p.priority,
                "targetDate": p.target_date.isoformat(),
            }
            for p in my_projects
        ],
    }


DASHBOARD_CARDS_PREFIX = "DASHBOARD_CARDS:"


def update_dashboard_card_order(*, user, order: list[str]) -> None:
    """Réplica exacta de `PATCH /api/dashboard/card-order`: el orden se
    codifica como UNA entrada de `view_preferences` con el prefijo
    `DASHBOARD_CARDS:` (mismo truco que el TS legacy — sin un campo
    dedicado), reemplazando cualquier entrada previa con ese prefijo."""
    existing = [v for v in user.view_preferences if not v.startswith(DASHBOARD_CARDS_PREFIX)]
    user.view_preferences = [*existing, f"{DASHBOARD_CARDS_PREFIX}{','.join(order)}"]
    user.save(update_fields=["view_preferences"])
