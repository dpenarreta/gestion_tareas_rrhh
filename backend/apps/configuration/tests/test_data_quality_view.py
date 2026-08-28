"""Cobertura de `build_data_quality_report`/`DataQualityView` — Fase 34
(ver docs/AUDIT_LOG.md § 2026-08-21), réplica de `GET
/api/settings/data-quality` (`route.ts`)."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.configuration.data_quality import build_data_quality_report
from apps.projects.models import Project, ProjectActivity
from apps.tasks.models import ActivityReason, Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!", first_name="Ana"
    )
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def _task(assigned_to: User, created_by: User, **overrides) -> Task:
    now = timezone.now()
    fields = {
        "title": "Tarea", "priority": Task.Priority.MEDIA, "frequency": Task.Frequency.PUNTUAL,
        "type": Task.Type.FIJA, "status": Task.Status.PENDIENTE,
        "start_date": now, "end_date": now + timedelta(days=3), "estimated_hours": 5,
        "assigned_to": assigned_to, "created_by": created_by,
    }
    fields.update(overrides)
    return Task.objects.create(**fields)


def _project(responsible: User, created_by: User, **overrides) -> Project:
    now = timezone.now()
    fields = {
        "name": "Proyecto", "priority": Task.Priority.MEDIA, "start_date": now,
        "target_date": now + timedelta(days=30), "target_time_hours": 40,
        "responsible": responsible, "created_by": created_by,
    }
    fields.update(overrides)
    return Project.objects.create(**fields)


def _find(report: dict, key: str) -> dict:
    return next(c for c in report["checks"] if c["key"] == key)


# --- GET /settings/data-quality/ (HTTP) ----------------------------------------------------


def test_requires_authentication():
    response = APIClient().get("/api/v1/settings/data-quality/")
    assert response.status_code == 401


def test_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/data-quality/")
    assert response.status_code == 403


def test_returns_all_7_checks():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).get("/api/v1/settings/data-quality/")
    assert response.status_code == 200
    keys = {c["key"] for c in response.data["checks"]}
    assert keys == {
        "fechas_invalidas", "calculos_fuera_de_rango", "sin_propietario", "motivo_huerfano",
        "retroactivo_inconsistente", "horas_duplicadas", "registros_huerfanos",
    }
    assert response.data["total_issues"] == 0
    assert "generated_at" in response.data


# --- fechas_invalidas ------------------------------------------------------------------------


def test_flags_task_with_end_before_start():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    now = timezone.now()
    _task(admin, admin, title="Vencida al revés", start_date=now, end_date=now - timedelta(days=1))

    report = build_data_quality_report(timezone.now())
    check = _find(report, "fechas_invalidas")
    assert check["count"] == 1
    assert "Vencida al revés" in check["items"][0]["label"]


# --- calculos_fuera_de_rango -----------------------------------------------------------------


def test_flags_progress_out_of_range():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    task = _task(admin, admin, title="Progreso raro")
    Task.objects.filter(pk=task.pk).update(progress=150)

    report = build_data_quality_report(timezone.now())
    check = _find(report, "calculos_fuera_de_rango")
    assert check["count"] == 1
    assert "Progreso raro" in check["items"][0]["label"]


def test_flags_negative_hours():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    task = _task(admin, admin, title="Horas negativas")
    Task.objects.filter(pk=task.pk).update(real_hours=-5)

    report = build_data_quality_report(timezone.now())
    check = _find(report, "calculos_fuera_de_rango")
    assert check["count"] == 1


# --- sin_propietario (defensivo — siempre 0, la FK es obligatoria) ---------------------------


def test_sin_propietario_is_empty_by_default():
    admin = _user_with_group("admin5", "ADMINISTRADOR")
    _task(admin, admin)
    _project(admin, admin)

    report = build_data_quality_report(timezone.now())
    assert _find(report, "sin_propietario")["count"] == 0


# --- motivo_huerfano --------------------------------------------------------------------------


def test_flags_activity_with_unknown_reason():
    admin = _user_with_group("admin6", "ADMINISTRADOR")
    ActivityReason.objects.create(key="REUNION", label="Reunión")
    task = _task(admin, admin, title="Con actividad")
    TaskActivity.objects.create(task=task, author=admin, reason="NO_EXISTE", duration=30)

    report = build_data_quality_report(timezone.now())
    check = _find(report, "motivo_huerfano")
    assert check["count"] == 1
    assert "NO_EXISTE" in check["items"][0]["label"]


def test_does_not_flag_activity_with_known_reason():
    admin = _user_with_group("admin7", "ADMINISTRADOR")
    ActivityReason.objects.create(key="REUNION", label="Reunión")
    task = _task(admin, admin)
    TaskActivity.objects.create(task=task, author=admin, reason="REUNION", duration=30)

    report = build_data_quality_report(timezone.now())
    assert _find(report, "motivo_huerfano")["count"] == 0


# --- retroactivo_inconsistente ------------------------------------------------------------------


def test_flags_retroactive_activity_without_date():
    admin = _user_with_group("admin8", "ADMINISTRADOR")
    task = _task(admin, admin, title="Retro sin fecha")
    TaskActivity.objects.create(
        task=task, author=admin, reason="reunion", duration=30, is_retroactive=True, activity_date=None
    )

    report = build_data_quality_report(timezone.now())
    check = _find(report, "retroactivo_inconsistente")
    assert check["count"] == 1
    assert "marcada retroactiva sin fecha" in check["items"][0]["label"]


def test_flags_non_retroactive_activity_with_mismatched_date():
    admin = _user_with_group("admin9", "ADMINISTRADOR")
    now = timezone.now()
    task = _task(admin, admin, title="Backdateada")
    activity = TaskActivity.objects.create(
        task=task, author=admin, reason="reunion", duration=30, is_retroactive=False,
        activity_date=now - timedelta(days=5),
    )
    TaskActivity.objects.filter(pk=activity.pk).update(created_at=now)

    report = build_data_quality_report(timezone.now())
    check = _find(report, "retroactivo_inconsistente")
    assert check["count"] == 1
    assert "sin marcar como retroactiva" in check["items"][0]["label"]


# --- horas_duplicadas --------------------------------------------------------------------------


def test_flags_overlapping_activities_same_author_same_day():
    admin = _user_with_group("admin10", "ADMINISTRADOR")
    task = _task(admin, admin, title="Con horario 1")
    project = _project(admin, admin)
    TaskActivity.objects.create(
        task=task, author=admin, reason="reunion", duration=60, start_time="09:00", end_time="10:00"
    )
    ProjectActivity.objects.create(
        project=project, author=admin, description="Trabajo", duration=60, start_time="09:30", end_time="10:30"
    )

    report = build_data_quality_report(timezone.now())
    check = _find(report, "horas_duplicadas")
    assert check["count"] == 2


def test_does_not_flag_non_overlapping_activities():
    admin = _user_with_group("admin11", "ADMINISTRADOR")
    task = _task(admin, admin)
    TaskActivity.objects.create(
        task=task, author=admin, reason="reunion", duration=60, start_time="09:00", end_time="10:00"
    )
    TaskActivity.objects.create(
        task=task, author=admin, reason="reunion", duration=60, start_time="11:00", end_time="12:00"
    )

    report = build_data_quality_report(timezone.now())
    assert _find(report, "horas_duplicadas")["count"] == 0


# --- registros_huerfanos (siempre vacío, con nota) ---------------------------------------------


def test_registros_huerfanos_is_always_empty_with_note():
    report = build_data_quality_report(timezone.now())
    check = _find(report, "registros_huerfanos")
    assert check["count"] == 0
    assert "note" in check
