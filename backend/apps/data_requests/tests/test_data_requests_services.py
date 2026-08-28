"""Cobertura de apps.data_requests.services — Fase 12 (ver
docs/AUDIT_LOG.md § 2026-08-19), réplica de los handlers `POST
/api/data-requests`, `PATCH /api/data-requests/[id]` y `GET
/api/data-requests/my-data`."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group

from apps.data_requests.models import DataSubjectRequest
from apps.data_requests.services import create_data_request, export_my_data, resolve_data_request
from apps.notifications.models import Notification
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


# --- create_data_request ----------------------------------------------------------


def test_create_acceso_does_not_notify_admins():
    user = _user_with_group("titular", "ASISTENTE_GH")
    admin = _user_with_group("admin1", "ADMINISTRADOR")
    create_data_request(user=user, type=DataSubjectRequest.Type.ACCESO, description=None)
    assert Notification.objects.filter(user=admin).count() == 0


def test_create_rectificacion_notifies_all_admins():
    user = _user_with_group("titular2", "ASISTENTE_GH")
    admin1 = _user_with_group("admin2", "ADMINISTRADOR")
    admin2 = _user_with_group("admin3", "ADMINISTRADOR")
    create_data_request(user=user, type=DataSubjectRequest.Type.RECTIFICACION, description="Corregir email")
    notified = set(Notification.objects.values_list("user_id", flat=True))
    assert notified == {admin1.id, admin2.id}
    notification = Notification.objects.get(user=admin1)
    assert notification.message == f"{user.first_name} solicitó rectificación de datos"


def test_create_eliminacion_notifies_admins_with_correct_label():
    user = _user_with_group("titular3", "ASISTENTE_GH")
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    create_data_request(user=user, type=DataSubjectRequest.Type.ELIMINACION, description=None)
    notification = Notification.objects.get(user=admin)
    assert notification.message == f"{user.first_name} solicitó eliminación de cuenta"


def test_create_data_request_defaults_to_pendiente():
    user = _user_with_group("titular4", "ASISTENTE_GH")
    data_request = create_data_request(user=user, type=DataSubjectRequest.Type.ACCESO, description=None)
    assert data_request.status == DataSubjectRequest.Status.PENDIENTE


# --- resolve_data_request -----------------------------------------------------------


def test_resolve_to_resuelta_sets_resolver_and_timestamp():
    user = _user_with_group("titular5", "ASISTENTE_GH")
    admin = _user_with_group("admin5", "ADMINISTRADOR")
    data_request = DataSubjectRequest.objects.create(user=user, type=DataSubjectRequest.Type.RECTIFICACION)

    updated = resolve_data_request(data_request=data_request, status=DataSubjectRequest.Status.RESUELTA, resolver=admin)
    assert updated.status == DataSubjectRequest.Status.RESUELTA
    assert updated.resolved_by == admin
    assert updated.resolved_at is not None


def test_resolve_to_non_resuelta_clears_resolver_even_if_previously_set():
    user = _user_with_group("titular6", "ASISTENTE_GH")
    admin = _user_with_group("admin6", "ADMINISTRADOR")
    data_request = DataSubjectRequest.objects.create(
        user=user, type=DataSubjectRequest.Type.RECTIFICACION, status=DataSubjectRequest.Status.RESUELTA,
        resolved_by=admin, resolved_at=datetime(2026, 1, 1, tzinfo=dt_timezone.utc),
    )

    updated = resolve_data_request(data_request=data_request, status=DataSubjectRequest.Status.EN_PROCESO, resolver=admin)
    assert updated.status == DataSubjectRequest.Status.EN_PROCESO
    assert updated.resolved_by is None
    assert updated.resolved_at is None


# --- export_my_data -----------------------------------------------------------------


def test_export_my_data_includes_user_basics():
    user = _user_with_group("titular7", "ASISTENTE_GH")
    payload = export_my_data(user=user)
    assert payload["usuario"]["id"] == user.id
    assert payload["usuario"]["email"] == user.email
    assert payload["usuario"]["roles"] == ["ASISTENTE_GH"]


def test_export_my_data_includes_own_tasks_only():
    user = _user_with_group("titular8", "ASISTENTE_GH")
    other = _user_with_group("other", "ASISTENTE_GH")
    Task.objects.create(
        title="Propia", priority="MEDIA", frequency="PUNTUAL",
        start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), end_date=datetime(2026, 8, 10, tzinfo=dt_timezone.utc),
        estimated_hours=5, assigned_to=user, created_by=user,
    )
    Task.objects.create(
        title="Ajena", priority="MEDIA", frequency="PUNTUAL",
        start_date=datetime(2026, 8, 1, tzinfo=dt_timezone.utc), end_date=datetime(2026, 8, 10, tzinfo=dt_timezone.utc),
        estimated_hours=5, assigned_to=other, created_by=other,
    )
    payload = export_my_data(user=user)
    assert len(payload["tareas"]) == 1
    assert payload["tareas"][0]["title"] == "Propia"


def test_export_my_data_creates_traceability_record():
    user = _user_with_group("titular9", "ASISTENTE_GH")
    assert DataSubjectRequest.objects.filter(user=user).count() == 0
    export_my_data(user=user)
    record = DataSubjectRequest.objects.get(user=user)
    assert record.type == DataSubjectRequest.Type.ACCESO
    assert record.status == DataSubjectRequest.Status.RESUELTA
    assert record.resolved_at is not None


def test_export_my_data_includes_prior_requests_before_the_new_traceability_one():
    user = _user_with_group("titular10", "ASISTENTE_GH")
    DataSubjectRequest.objects.create(user=user, type=DataSubjectRequest.Type.RECTIFICACION)
    payload = export_my_data(user=user)
    # El registro de trazabilidad se crea DESPUÉS de armar el payload -> no debe aparecer en él.
    assert len(payload["solicitudes_previas"]) == 1
    assert payload["solicitudes_previas"][0]["type"] == DataSubjectRequest.Type.RECTIFICACION
