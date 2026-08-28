"""Cobertura de `apps.users.badges`/`BadgesView` — Fase 27 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `GET /api/profile/badges`
(`src/app/api/profile/badges/route.ts`)."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.tasks.models import Comment, Task, TaskActivity
from apps.users.badges import compute_and_persist_badges
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


def _create_task(*, assigned_to: User, created_by: User, **overrides) -> Task:
    now = timezone.now()
    payload = dict(
        title="Tarea", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.FIJA,
        start_date=now, end_date=now, estimated_hours=5,
        assigned_to=assigned_to, created_by=created_by, status=Task.Status.PENDIENTE,
    )
    payload.update(overrides)
    return Task.objects.create(**payload)


def _badge(badges: list[dict], badge_id: str) -> dict:
    return next(b for b in badges if b["id"] == badge_id)


# --- GET /profile/badges/ (HTTP) ----------------------------------------------------------


def test_requires_authentication():
    response = APIClient().get("/api/v1/profile/badges/")
    assert response.status_code == 401


def test_returns_all_6_badge_definitions(analista):
    response = _client_for(analista).get("/api/v1/profile/badges/")
    assert response.status_code == 200
    ids = {b["id"] for b in response.data["badges"]}
    assert ids == {"cumplidor", "innovador", "colaborador", "confiable", "constante", "mentor"}


# --- cumplidor / confiable ------------------------------------------------------------------


def test_cumplidor_earned_at_80_pct_completion(analista):
    now = timezone.now()
    for _ in range(4):
        _create_task(assigned_to=analista, created_by=analista, status=Task.Status.COMPLETADA, end_date=now)
    _create_task(assigned_to=analista, created_by=analista, status=Task.Status.PENDIENTE, end_date=now)

    result = compute_and_persist_badges(user=analista, now=now)
    assert _badge(result["badges"], "cumplidor")["earned"] is True
    assert _badge(result["badges"], "confiable")["earned"] is False


def test_confiable_earned_at_95_pct_completion(analista):
    now = timezone.now()
    for _ in range(19):
        _create_task(assigned_to=analista, created_by=analista, status=Task.Status.COMPLETADA, end_date=now)
    _create_task(assigned_to=analista, created_by=analista, status=Task.Status.PENDIENTE, end_date=now)

    result = compute_and_persist_badges(user=analista, now=now)
    assert _badge(result["badges"], "confiable")["earned"] is True


def test_neither_earned_below_threshold(analista):
    now = timezone.now()
    _create_task(assigned_to=analista, created_by=analista, status=Task.Status.COMPLETADA, end_date=now)
    _create_task(assigned_to=analista, created_by=analista, status=Task.Status.PENDIENTE, end_date=now)

    result = compute_and_persist_badges(user=analista, now=now)
    assert _badge(result["badges"], "cumplidor")["earned"] is False


def test_month_scoped_tasks_outside_current_month_do_not_count(analista):
    now = timezone.now()
    last_month = now - timedelta(days=45)
    for _ in range(5):
        _create_task(assigned_to=analista, created_by=analista, status=Task.Status.COMPLETADA, end_date=last_month)

    result = compute_and_persist_badges(user=analista, now=now)
    assert _badge(result["badges"], "cumplidor")["earned"] is False


# --- colaborador -----------------------------------------------------------------------------


def test_colaborador_earned_with_20_comments(analista):
    task = _create_task(assigned_to=analista, created_by=analista)
    for _ in range(20):
        Comment.objects.create(task=task, author=analista, text="Comentario")

    result = compute_and_persist_badges(user=analista, now=timezone.now())
    assert _badge(result["badges"], "colaborador")["earned"] is True


def test_colaborador_not_earned_below_20_comments(analista):
    task = _create_task(assigned_to=analista, created_by=analista)
    for _ in range(19):
        Comment.objects.create(task=task, author=analista, text="Comentario")

    result = compute_and_persist_badges(user=analista, now=timezone.now())
    assert _badge(result["badges"], "colaborador")["earned"] is False


# --- innovador (solo refleja lo ya guardado) --------------------------------------------------


def test_innovador_reflects_existing_stored_badge(analista):
    analista.badges = ["innovador"]
    analista.save(update_fields=["badges"])

    result = compute_and_persist_badges(user=analista, now=timezone.now())
    assert _badge(result["badges"], "innovador")["earned"] is True


def test_innovador_not_earned_when_not_stored(analista):
    result = compute_and_persist_badges(user=analista, now=timezone.now())
    assert _badge(result["badges"], "innovador")["earned"] is False


# --- mentor ------------------------------------------------------------------------------------


def test_mentor_earned_when_others_reply_5_times_on_commented_task(analista):
    other = User.objects.create_user(username="otro", email="otro@example.com", password="Sup3r-Secr3t!")
    task = _create_task(assigned_to=analista, created_by=analista)
    Comment.objects.create(task=task, author=analista, text="Mi comentario")
    for _ in range(5):
        Comment.objects.create(task=task, author=other, text="Respuesta")

    result = compute_and_persist_badges(user=analista, now=timezone.now())
    assert _badge(result["badges"], "mentor")["earned"] is True


def test_mentor_not_earned_below_5_other_replies(analista):
    other = User.objects.create_user(username="otro2", email="otro2@example.com", password="Sup3r-Secr3t!")
    task = _create_task(assigned_to=analista, created_by=analista)
    Comment.objects.create(task=task, author=analista, text="Mi comentario")
    for _ in range(4):
        Comment.objects.create(task=task, author=other, text="Respuesta")

    result = compute_and_persist_badges(user=analista, now=timezone.now())
    assert _badge(result["badges"], "mentor")["earned"] is False


def test_mentor_not_earned_without_any_comment_from_self(analista):
    result = compute_and_persist_badges(user=analista, now=timezone.now())
    assert _badge(result["badges"], "mentor")["earned"] is False


# --- constante -----------------------------------------------------------------------------


def _activity_on_day(*, task: Task, author: User, day) -> TaskActivity:
    activity = TaskActivity.objects.create(task=task, author=author, reason="reunion", duration=30)
    TaskActivity.objects.filter(pk=activity.pk).update(created_at=day)
    return activity


def test_constante_earned_with_15_consecutive_days(analista):
    now = timezone.now()
    task = _create_task(assigned_to=analista, created_by=analista)
    for i in range(15):
        _activity_on_day(task=task, author=analista, day=now - timedelta(days=i))

    result = compute_and_persist_badges(user=analista, now=now)
    assert _badge(result["badges"], "constante")["earned"] is True


def test_constante_not_earned_with_gap_in_days(analista):
    now = timezone.now()
    task = _create_task(assigned_to=analista, created_by=analista)
    for i in range(14):
        _activity_on_day(task=task, author=analista, day=now - timedelta(days=i))
    # 15th activity, pero con un salto de 2 días respecto a la última — rompe la racha
    _activity_on_day(task=task, author=analista, day=now - timedelta(days=16))

    result = compute_and_persist_badges(user=analista, now=now)
    assert _badge(result["badges"], "constante")["earned"] is False


def test_constante_not_earned_below_15_total_activities(analista):
    now = timezone.now()
    task = _create_task(assigned_to=analista, created_by=analista)
    for i in range(14):
        _activity_on_day(task=task, author=analista, day=now - timedelta(days=i))

    result = compute_and_persist_badges(user=analista, now=now)
    assert _badge(result["badges"], "constante")["earned"] is False


# --- persistencia --------------------------------------------------------------------------


def test_persists_newly_earned_badges(analista):
    task = _create_task(assigned_to=analista, created_by=analista)
    for _ in range(20):
        Comment.objects.create(task=task, author=analista, text="Comentario")

    compute_and_persist_badges(user=analista, now=timezone.now())
    analista.refresh_from_db()
    assert "colaborador" in analista.badges


def test_never_removes_previously_earned_badges(analista):
    analista.badges = ["innovador"]
    analista.save(update_fields=["badges"])

    compute_and_persist_badges(user=analista, now=timezone.now())
    analista.refresh_from_db()
    assert "innovador" in analista.badges


def test_does_not_duplicate_badge_already_stored(analista):
    task = _create_task(assigned_to=analista, created_by=analista)
    for _ in range(20):
        Comment.objects.create(task=task, author=analista, text="Comentario")
    analista.badges = ["colaborador"]
    analista.save(update_fields=["badges"])

    compute_and_persist_badges(user=analista, now=timezone.now())
    analista.refresh_from_db()
    assert analista.badges.count("colaborador") == 1


# --- stats -----------------------------------------------------------------------------------


def test_stats_total_completed_comments_and_earned_count(analista):
    now = timezone.now()
    _create_task(assigned_to=analista, created_by=analista, status=Task.Status.COMPLETADA, end_date=now)
    task = _create_task(assigned_to=analista, created_by=analista)
    for _ in range(20):
        Comment.objects.create(task=task, author=analista, text="Comentario")

    result = compute_and_persist_badges(user=analista, now=now)
    assert result["stats"]["totalCompleted"] == 1
    assert result["stats"]["totalComments"] == 20
    assert result["stats"]["earnedCount"] == 1


def test_current_streak_zero_when_last_activity_is_old(analista):
    now = timezone.now()
    task = _create_task(assigned_to=analista, created_by=analista)
    _activity_on_day(task=task, author=analista, day=now - timedelta(days=10))

    result = compute_and_persist_badges(user=analista, now=now)
    assert result["stats"]["currentStreak"] == 0


def test_current_streak_counts_consecutive_days_up_to_today(analista):
    now = timezone.now()
    task = _create_task(assigned_to=analista, created_by=analista)
    for i in range(3):
        _activity_on_day(task=task, author=analista, day=now - timedelta(days=i))

    result = compute_and_persist_badges(user=analista, now=now)
    assert result["stats"]["currentStreak"] == 3
