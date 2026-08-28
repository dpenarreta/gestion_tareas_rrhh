"""Gamificación de perfil — Fase 27 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-20). Réplica exacta de `GET /api/profile/
badges` (`src/app/api/profile/badges/route.ts`): calcula 6 insignias
sobre datos ya portados (Tareas/Comentarios/Actividades), persiste las
recién ganadas en `User.badges` (nunca las quita) y devuelve
estadísticas de racha/actividad."""

from datetime import datetime, timedelta

from apps.tasks.models import Comment, Task, TaskActivity

BADGE_DEFS = (
    {"id": "cumplidor", "icon": "🎯", "name": "Cumplidor", "description": "Completó 80%+ de tareas a tiempo en un mes"},
    {"id": "innovador", "icon": "💡", "name": "Innovador", "description": "Tiene una idea implementada"},
    {"id": "colaborador", "icon": "🤝", "name": "Colaborador", "description": "Registró 20 o más comentarios en tareas"},
    {"id": "confiable", "icon": "🏅", "name": "Confiable", "description": "Más del 95% de cumplimiento sostenido"},
    {"id": "constante", "icon": "📋", "name": "Constante", "description": "Registró actividades por 15 días consecutivos"},
    {"id": "mentor", "icon": "🌟", "name": "Mentor", "description": "Sus comentarios generaron respuestas en tareas"},
)


def _month_bounds(now: datetime) -> tuple[datetime, datetime]:
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_year, next_month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    end = start.replace(year=next_year, month=next_month) - timedelta(milliseconds=1)
    return start, end


def _longest_consecutive_day_streak(days: list[str]) -> int:
    """`days` ordenados asc, `"YYYY-MM-DD"` — réplica de la racha
    calculada inline en `route.ts` para el badge "constante"."""
    max_streak = streak = 1
    for i in range(1, len(days)):
        prev = datetime.strptime(days[i - 1], "%Y-%m-%d")
        curr = datetime.strptime(days[i], "%Y-%m-%d")
        if (curr - prev).days == 1:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 1
    return max_streak


def _current_streak_days(days_all: list[str], now: datetime) -> int:
    """Racha ACTUAL (no la máxima histórica) — solo cuenta si el último
    día con actividad es hoy o ayer, réplica exacta de `currentStreakDays`."""
    if not days_all:
        return 0
    today = now.strftime("%Y-%m-%d")
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    if days_all[-1] not in (today, yesterday):
        return 0
    streak = 1
    for i in range(len(days_all) - 2, -1, -1):
        curr = datetime.strptime(days_all[i + 1], "%Y-%m-%d")
        prev = datetime.strptime(days_all[i], "%Y-%m-%d")
        if (curr - prev).days == 1:
            streak += 1
        else:
            break
    return streak


def compute_and_persist_badges(*, user, now: datetime) -> dict:
    month_start, month_end = _month_bounds(now)

    month_tasks = list(
        Task.objects.filter(assigned_to=user, end_date__gte=month_start, end_date__lte=month_end).only(
            "status", "end_date"
        )
    )
    total_comments = Comment.objects.filter(author=user).count()
    all_activities = list(
        TaskActivity.objects.filter(author=user).order_by("created_at").only("created_at")
    )

    completed = sum(1 for t in month_tasks if t.status == Task.Status.COMPLETADA)
    completed_pct = (completed / len(month_tasks) * 100) if month_tasks else 0
    is_cumplidor = completed_pct >= 80
    is_confiable = completed_pct >= 95
    is_colaborador = total_comments >= 20

    user_comment_task_ids = list(
        Comment.objects.filter(author=user).values_list("task_id", flat=True).distinct()
    )
    is_mentor = False
    if user_comment_task_ids:
        other_comments = Comment.objects.filter(task_id__in=user_comment_task_ids).exclude(author=user).count()
        is_mentor = other_comments >= 5

    is_constante = False
    if len(all_activities) >= 15:
        activity_days = sorted({a.created_at.strftime("%Y-%m-%d") for a in all_activities})
        is_constante = _longest_consecutive_day_streak(activity_days) >= 15

    existing_badges = user.badges or []
    earned_flags = {
        "cumplidor": is_cumplidor,
        "innovador": "innovador" in existing_badges,
        "colaborador": is_colaborador,
        "confiable": is_confiable,
        "constante": is_constante,
        "mentor": is_mentor,
    }
    badges = [{**definition, "earned": earned_flags[definition["id"]]} for definition in BADGE_DEFS]

    earned_ids = [b["id"] for b in badges if b["earned"]]
    new_badges = list(dict.fromkeys([*existing_badges, *earned_ids]))
    if new_badges != existing_badges:
        user.badges = new_badges
        user.save(update_fields=["badges"])

    total_completed = Task.objects.filter(assigned_to=user, status=Task.Status.COMPLETADA).count()
    total_comments_all = Comment.objects.filter(author=user).count()
    activity_days_all = sorted({a.created_at.strftime("%Y-%m-%d") for a in all_activities})
    current_streak_days = _current_streak_days(activity_days_all, now)

    return {
        "badges": badges,
        "stats": {
            "totalCompleted": total_completed,
            "totalComments": total_comments_all,
            "currentStreak": current_streak_days,
            "earnedCount": len(earned_ids),
        },
    }
