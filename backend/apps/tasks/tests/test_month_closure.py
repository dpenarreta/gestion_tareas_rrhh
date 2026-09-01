"""Cobertura del Motor de Cierre Inteligente — sub-fase 3d (ver
docs/AUDIT_LOG.md § 2026-08-07)."""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework.test import APIClient

from apps.configuration.models import Holiday, SystemConfigHistory
from apps.configuration.services import CONFIG_KEY_HORAS_EFECTIVAS
from apps.permissions.models import ModulePermission
from apps.tasks.models import MonthClosure, Task
from apps.users.models import User

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 1
ARCHIVED_KEY = f"{YEAR}-{MONTH:02d}"


def _grant_permission(user: User, codename: str) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(Permission.objects.get(content_type=content_type, codename=codename))


@pytest.fixture
def manager():
    # `tareas.cerrar_mes` — antes reutilizaba `usuarios.editar` (ver
    # docs/AUDIT_LOG.md § 2026-09-01, "Catálogo dinámico de permisos
    # extendido a todo el sistema"), ahora tiene su propio codename.
    user = User.objects.create_user(
        username="manager", email="manager@example.com", password="Sup3r-Secr3t!"
    )
    _grant_permission(user, "tareas.cerrar_mes")
    return user


@pytest.fixture
def manager_client(manager):
    client = APIClient()
    client.force_authenticate(user=manager)
    return client


@pytest.fixture
def administrador():
    return User.objects.create_user(
        username="admin", email="admin@example.com", password="Sup3r-Secr3t!", is_superuser=True
    )


@pytest.fixture
def administrador_client(administrador):
    client = APIClient()
    client.force_authenticate(user=administrador)
    return client


@pytest.fixture
def collaborator():
    return User.objects.create_user(
        username="collab", email="collab@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def collaborator_client(collaborator):
    client = APIClient()
    client.force_authenticate(user=collaborator)
    return client


def _dt(day: int) -> datetime:
    return datetime(YEAR, MONTH, day, tzinfo=dt_timezone.utc)


def _task(assigned_to: User, created_by: User, **overrides) -> Task:
    fields = {
        "title": "Tarea de cierre",
        "priority": "MEDIA",
        "frequency": "PUNTUAL",
        "type": "FIJA",
        "status": "PENDIENTE",
        "start_date": _dt(2),
        "end_date": _dt(15),
        "estimated_hours": 5,
        "assigned_to": assigned_to,
        "created_by": created_by,
    }
    fields.update(overrides)
    return Task.objects.create(**fields)


def _make_closure(*, closed_by: User) -> MonthClosure:
    return MonthClosure.objects.create(
        month=MONTH,
        year=YEAR,
        closed_by=closed_by,
        cutoff_date=_dt(31),
        closure_type="NORMAL",
        calendar_days_total=31,
        calendar_days_considered=31,
        working_days_considered=20,
        working_hours_considered=130.0,
        total_tasks=1,
        completed_tasks=1,
        summary={},
    )


# --- preview -----------------------------------------------------------


def test_preview_shows_candidates_and_not_closed(manager_client, manager, collaborator):
    _task(collaborator, manager, status="COMPLETADA")

    response = manager_client.get(f"/api/v1/tasks/close-month/?year={YEAR}&month={MONTH}")

    assert response.status_code == 200
    assert response.data["already_closed"] is False
    assert response.data["total"] == 1
    assert response.data["completed"] == 1


def test_actor_without_can_close_month_gets_403(collaborator_client):
    response = collaborator_client.get(f"/api/v1/tasks/close-month/?year={YEAR}&month={MONTH}")
    assert response.status_code == 403


def test_invalid_month_returns_400(manager_client):
    response = manager_client.get(f"/api/v1/tasks/close-month/?year={YEAR}&month=13")
    assert response.status_code == 400


# --- execute: qué se archiva --------------------------------------------


def test_close_month_archives_fija_regardless_of_status(manager_client, manager, collaborator):
    task = _task(collaborator, manager, type="FIJA", status="PENDIENTE")

    response = manager_client.post(
        "/api/v1/tasks/close-month/", {"year": YEAR, "month": MONTH}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.archived_month == ARCHIVED_KEY
    assert task.archived_at is not None


def test_close_month_archives_seguimiento_only_if_completed(manager_client, manager, collaborator):
    completed = _task(
        collaborator, manager, type="SEGUIMIENTO", status="COMPLETADA", title="Completada"
    )
    active = _task(collaborator, manager, type="SEGUIMIENTO", status="EN_PROGRESO", title="Activa")

    response = manager_client.post(
        "/api/v1/tasks/close-month/", {"year": YEAR, "month": MONTH}, format="json"
    )

    assert response.status_code == 200
    assert response.data["archived_count"] == 1
    assert response.data["continued_active_count"] == 1
    completed.refresh_from_db()
    active.refresh_from_db()
    assert completed.archived_month == ARCHIVED_KEY
    assert active.archived_month is None


# --- duplicación de recurrentes ------------------------------------------


def test_close_month_duplicates_recurring_frequency_to_next_month(
    manager_client, manager, collaborator
):
    _task(collaborator, manager, frequency="MENSUAL", start_date=_dt(5), end_date=_dt(20))

    response = manager_client.post(
        "/api/v1/tasks/close-month/", {"year": YEAR, "month": MONTH}, format="json"
    )

    assert response.status_code == 200
    assert response.data["duplicated_count"] == 1
    duplicate = Task.objects.get(archived_month__isnull=True, frequency="MENSUAL")
    assert duplicate.status == "PENDIENTE"
    assert duplicate.real_hours == 0
    assert duplicate.progress == 0
    assert duplicate.start_date == datetime(YEAR, 2, 5, tzinfo=dt_timezone.utc)
    assert duplicate.end_date == datetime(YEAR, 2, 20, tzinfo=dt_timezone.utc)


def test_close_month_does_not_duplicate_puntual(manager_client, manager, collaborator):
    _task(collaborator, manager, frequency="PUNTUAL")

    response = manager_client.post(
        "/api/v1/tasks/close-month/", {"year": YEAR, "month": MONTH}, format="json"
    )

    assert response.data["duplicated_count"] == 0


def test_close_month_duplicate_clamps_day_at_month_end(manager_client, manager, collaborator):
    _task(collaborator, manager, frequency="SEMANAL", start_date=_dt(31), end_date=_dt(31))

    manager_client.post("/api/v1/tasks/close-month/", {"year": YEAR, "month": MONTH}, format="json")

    duplicate = Task.objects.get(archived_month__isnull=True, frequency="SEMANAL")
    assert duplicate.end_date == datetime(
        YEAR, 2, 28, tzinfo=dt_timezone.utc
    )  # 2026 no es bisiesto


# --- doble cierre --------------------------------------------------------


def test_closing_same_month_twice_returns_409(manager_client, manager, collaborator):
    _task(collaborator, manager)

    first = manager_client.post(
        "/api/v1/tasks/close-month/", {"year": YEAR, "month": MONTH}, format="json"
    )
    assert first.status_code == 200

    second = manager_client.post(
        "/api/v1/tasks/close-month/", {"year": YEAR, "month": MONTH}, format="json"
    )
    assert second.status_code == 409


# --- campos numéricos informativos ---------------------------------------


def test_calendar_days_considered_equals_cutoff_day(manager_client, manager, collaborator):
    _task(collaborator, manager)

    response = manager_client.get(
        f"/api/v1/tasks/close-month/?year={YEAR}&month={MONTH}&cutoffDate={YEAR}-01-20"
    )

    assert response.data["calendar_days_considered"] == 20


def test_working_days_hours_considered_reflect_config_and_holidays(
    manager_client, manager, administrador, collaborator
):
    # `valid_from` bien anterior al mes que se cierra (2026-01) — la
    # semántica "vigente a la fecha" nunca es retroactiva, ver
    # test_effective_value_is_never_retroactive en apps.configuration.
    SystemConfigHistory.objects.create(
        key=CONFIG_KEY_HORAS_EFECTIVAS,
        value="8.0",
        valid_from=datetime(2020, 1, 1, tzinfo=dt_timezone.utc),
        updated_by=administrador,
    )
    Holiday.objects.create(date=date(YEAR, 1, 1), name="Año Nuevo", year=YEAR)  # jueves
    _task(collaborator, manager)

    response = manager_client.get(
        f"/api/v1/tasks/close-month/?year={YEAR}&month={MONTH}&cutoffDate={YEAR}-01-09"
    )

    # 1..9 enero: 1=feriado, 3-4=fin de semana -> hábiles: 2,5,6,7,8,9 = 6
    assert response.data["working_days_considered"] == 6
    assert response.data["working_hours_considered"] == 48.0


# --- /correct (corrección de Admin sobre archivadas) ---------------------


def test_correct_rejects_non_archived_task(administrador_client, manager, collaborator):
    task = _task(collaborator, manager)

    response = administrador_client.patch(
        f"/api/v1/tasks/{task.id}/correct/", {"real_hours": 5}, format="json"
    )

    assert response.status_code == 400


def test_correct_dedupes_identical_values(administrador_client, manager, collaborator):
    task = _task(
        collaborator,
        manager,
        real_hours=5.0,
        archived_month=ARCHIVED_KEY,
        archived_at=timezone.now(),
    )

    response = administrador_client.patch(
        f"/api/v1/tasks/{task.id}/correct/", {"real_hours": 5.0}, format="json"
    )

    assert response.status_code == 400


def test_correct_updates_monthclosure_corrections(
    administrador_client, administrador, manager, collaborator
):
    task = _task(
        collaborator,
        manager,
        real_hours=5.0,
        archived_month=ARCHIVED_KEY,
        archived_at=timezone.now(),
    )
    closure = _make_closure(closed_by=administrador)

    response = administrador_client.patch(
        f"/api/v1/tasks/{task.id}/correct/", {"real_hours": 8.5}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.real_hours == 8.5
    assert task.corrected is True
    closure.refresh_from_db()
    assert len(closure.corrections) == 1
    assert closure.corrections[0]["field"] == "realHours"


def test_correct_status_change_updates_progress_and_completed_at(
    administrador_client, manager, collaborator
):
    task = _task(
        collaborator,
        manager,
        status="PENDIENTE",
        archived_month=ARCHIVED_KEY,
        archived_at=timezone.now(),
    )

    response = administrador_client.patch(
        f"/api/v1/tasks/{task.id}/correct/", {"status": "COMPLETADA"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.status == "COMPLETADA"
    assert task.progress == 100
    assert task.completed_at is not None


def test_correct_without_monthclosure_still_succeeds(administrador_client, manager, collaborator):
    task = _task(
        collaborator,
        manager,
        real_hours=5.0,
        archived_month=ARCHIVED_KEY,
        archived_at=timezone.now(),
    )

    response = administrador_client.patch(
        f"/api/v1/tasks/{task.id}/correct/", {"real_hours": 9.0}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.real_hours == 9.0


def test_manager_cannot_use_correct_only_administrador(manager_client, manager, collaborator):
    task = _task(
        collaborator,
        manager,
        real_hours=5.0,
        archived_month=ARCHIVED_KEY,
        archived_at=timezone.now(),
    )

    response = manager_client.patch(
        f"/api/v1/tasks/{task.id}/correct/", {"real_hours": 6.0}, format="json"
    )

    assert response.status_code == 403


def test_correct_nothing_changed_returns_400(administrador_client, manager, collaborator):
    task = _task(
        collaborator,
        manager,
        status="PENDIENTE",
        real_hours=5.0,
        archived_month=ARCHIVED_KEY,
        archived_at=timezone.now(),
    )

    response = administrador_client.patch(
        f"/api/v1/tasks/{task.id}/correct/",
        {"real_hours": 5.0, "status": "PENDIENTE"},
        format="json",
    )

    assert response.status_code == 400


# --- Repositorio -----------------------------------------------------------


def test_repository_scoped_to_own_tasks_gap(manager_client, administrador, manager, collaborator):
    task = _task(
        collaborator,
        manager,
        real_hours=3.0,
        status="COMPLETADA",
        archived_month=ARCHIVED_KEY,
        archived_at=timezone.now(),
    )
    _make_closure(closed_by=administrador)

    manager_list = manager_client.get("/api/v1/tasks/repository/")
    assert manager_list.data == []

    collaborator_client = APIClient()
    collaborator_client.force_authenticate(user=collaborator)
    collaborator_list = collaborator_client.get("/api/v1/tasks/repository/")
    assert len(collaborator_list.data) == 1
    assert collaborator_list.data[0]["total_tasks"] == 1
    assert collaborator_list.data[0]["completed_tasks"] == 1
    assert collaborator_list.data[0]["total_hours"] == 3.0

    detail = collaborator_client.get(f"/api/v1/tasks/repository/{YEAR}/{MONTH}/")
    assert detail.status_code == 200
    assert len(detail.data) == 1
    assert detail.data[0]["id"] == task.id


def test_repository_detail_404_if_month_never_closed(manager_client):
    response = manager_client.get(f"/api/v1/tasks/repository/{YEAR}/{MONTH}/")
    assert response.status_code == 404
