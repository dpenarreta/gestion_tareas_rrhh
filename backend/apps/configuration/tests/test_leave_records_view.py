"""Cobertura HTTP de `/api/v1/settings/leave-records/` — Fase 29 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `route.ts`/`[id]/route.ts`."""

from datetime import date

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.models import Holiday, LeaveRecord
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="Sup3r-Secr3t!",
        first_name="Ana",
    )
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def _superuser(username: str) -> User:
    """Hallazgo H-5 de la auditoría de datos personales (ver
    docs/AUDIT_LOG.md § 2026-09-02): estos endpoints ahora exigen
    `is_superuser=True` real, no solo pertenencia al grupo ADMINISTRADOR
    (antes inconsistente con el gate de `redact_sensitive_workload_detail`
    en KPIs) — los fixtures "admin" de este archivo deben serlo de verdad."""
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="Sup3r-Secr3t!",
        first_name="Ana",
        is_superuser=True,
    )
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    return user


# --- GET /settings/leave-records/ ---------------------------------------------------------


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/leave-records/")
    assert response.status_code == 401


def test_get_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/leave-records/")
    assert response.status_code == 403


def test_get_rejects_administrador_group_without_real_superuser():
    """Hallazgo H-5 de la auditoría de datos personales (ver
    docs/AUDIT_LOG.md § 2026-09-02): antes de esta corrección, un usuario
    en el grupo ADMINISTRADOR sin `is_superuser=True` (estado real
    alcanzable, ver docs/DECISIONS.md § 2026-09-01) pasaba este gate
    pero recibía la versión REDACTADA en KPIs — inconsistente."""
    user = _user_with_group("admin_solo_grupo", "ADMINISTRADOR")
    assert user.is_superuser is False
    response = _client_for(user).get("/api/v1/settings/leave-records/")
    assert response.status_code == 403


def test_get_filters_by_user_id():
    admin = _superuser("admin")
    target = _user_with_group("analista", "ANALISTA_CC")
    other = _user_with_group("otro", "ANALISTA_CC")
    LeaveRecord.objects.create(
        user=target,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=True,
        created_by=admin,
    )
    LeaveRecord.objects.create(
        user=other,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=True,
        created_by=admin,
    )

    response = _client_for(admin).get(f"/api/v1/settings/leave-records/?user_id={target.id}")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["user"]["name"] == "Ana"


def test_get_filters_by_month():
    admin = _superuser("admin2")
    target = _user_with_group("analista2", "ANALISTA_CC")
    LeaveRecord.objects.create(
        user=target,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=True,
        created_by=admin,
    )
    LeaveRecord.objects.create(
        user=target,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 2, 5),
        is_full_day=True,
        created_by=admin,
    )

    response = _client_for(admin).get("/api/v1/settings/leave-records/?month=2026-01")
    assert len(response.data) == 1
    assert response.data[0]["date"] == "2026-01-05"


# --- POST /settings/leave-records/ --------------------------------------------------------


def test_post_requires_administrador():
    user = _user_with_group("jefe2", "JEFE_NACIONAL")
    target = _user_with_group("analista3", "ANALISTA_CC")
    body = {
        "user_id": target.id,
        "type": "MEDICO",
        "start_date": "2026-01-05",
        "end_date": "2026-01-05",
        "is_full_day": True,
    }
    response = _client_for(user).post("/api/v1/settings/leave-records/", body, format="json")
    assert response.status_code == 403


def test_post_400_for_end_before_start():
    admin = _superuser("admin3")
    target = _user_with_group("analista4", "ANALISTA_CC")
    body = {
        "user_id": target.id,
        "type": "MEDICO",
        "start_date": "2026-01-05",
        "end_date": "2026-01-01",
        "is_full_day": True,
    }
    response = _client_for(admin).post("/api/v1/settings/leave-records/", body, format="json")
    assert response.status_code == 400


def test_post_400_for_vacaciones_not_full_day():
    admin = _superuser("admin4")
    target = _user_with_group("analista5", "ANALISTA_CC")
    body = {
        "user_id": target.id,
        "type": "VACACIONES",
        "start_date": "2026-01-05",
        "end_date": "2026-01-05",
        "is_full_day": False,
        "duration_minutes": 60,
    }
    response = _client_for(admin).post("/api/v1/settings/leave-records/", body, format="json")
    assert response.status_code == 400


def test_post_400_for_missing_duration_when_not_full_day():
    admin = _superuser("admin5")
    target = _user_with_group("analista6", "ANALISTA_CC")
    body = {
        "user_id": target.id,
        "type": "MEDICO",
        "start_date": "2026-01-05",
        "end_date": "2026-01-05",
        "is_full_day": False,
    }
    response = _client_for(admin).post("/api/v1/settings/leave-records/", body, format="json")
    assert response.status_code == 400


def test_post_404_for_unknown_user():
    admin = _superuser("admin6")
    body = {
        "user_id": 999999,
        "type": "MEDICO",
        "start_date": "2026-01-05",
        "end_date": "2026-01-05",
        "is_full_day": True,
    }
    response = _client_for(admin).post("/api/v1/settings/leave-records/", body, format="json")
    assert response.status_code == 404


def test_post_400_when_range_has_no_business_days():
    admin = _superuser("admin7")
    target = _user_with_group("analista7", "ANALISTA_CC")
    # 2026-01-10/11 son sábado/domingo.
    body = {
        "user_id": target.id,
        "type": "MEDICO",
        "start_date": "2026-01-10",
        "end_date": "2026-01-11",
        "is_full_day": True,
    }
    response = _client_for(admin).post("/api/v1/settings/leave-records/", body, format="json")
    assert response.status_code == 400


def test_post_excludes_holidays_from_business_days():
    admin = _superuser("admin8")
    target = _user_with_group("analista8", "ANALISTA_CC")
    Holiday.objects.create(date=date(2026, 1, 6), name="Feriado", year=2026)
    # Lunes 5 a viernes 9 de enero de 2026 -> 5 días laborables, menos el feriado del martes 6 = 4.
    body = {
        "user_id": target.id,
        "type": "MEDICO",
        "start_date": "2026-01-05",
        "end_date": "2026-01-09",
        "is_full_day": True,
    }
    response = _client_for(admin).post("/api/v1/settings/leave-records/", body, format="json")
    assert response.status_code == 201
    assert response.data["businessDaysCount"] == 4
    dates = {r["date"] for r in response.data["records"]}
    assert "2026-01-06" not in dates


def test_post_creates_one_record_per_business_day_with_created_by():
    admin = _superuser("admin9")
    target = _user_with_group("analista9", "ANALISTA_CC")
    body = {
        "user_id": target.id,
        "type": "PERSONAL",
        "start_date": "2026-01-05",
        "end_date": "2026-01-09",
        "is_full_day": False,
        "duration_minutes": 90,
        "observation": "  Motivo  ",
    }
    response = _client_for(admin).post("/api/v1/settings/leave-records/", body, format="json")
    assert response.status_code == 201
    assert response.data["businessDaysCount"] == 5
    records = LeaveRecord.objects.filter(user=target)
    assert records.count() == 5
    assert all(r.duration_minutes == 90 for r in records)
    assert all(r.observation == "Motivo" for r in records)
    assert all(r.created_by_id == admin.id for r in records)


# --- DELETE /settings/leave-records/<id>/ -------------------------------------------------


def test_delete_requires_administrador():
    admin = _superuser("admin10")
    target = _user_with_group("analista10", "ANALISTA_CC")
    record = LeaveRecord.objects.create(
        user=target,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=True,
        created_by=admin,
    )
    user = _user_with_group("jefe3", "JEFE_NACIONAL")
    response = _client_for(user).delete(f"/api/v1/settings/leave-records/{record.id}/")
    assert response.status_code == 403


def test_delete_404_for_missing_record():
    admin = _superuser("admin11")
    response = _client_for(admin).delete("/api/v1/settings/leave-records/999999/")
    assert response.status_code == 404


def test_delete_removes_record():
    admin = _superuser("admin12")
    target = _user_with_group("analista11", "ANALISTA_CC")
    record = LeaveRecord.objects.create(
        user=target,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=True,
        created_by=admin,
    )
    response = _client_for(admin).delete(f"/api/v1/settings/leave-records/{record.id}/")
    assert response.status_code == 200
    assert not LeaveRecord.objects.filter(pk=record.id).exists()
