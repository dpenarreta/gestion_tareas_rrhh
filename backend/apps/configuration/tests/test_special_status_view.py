"""Cobertura HTTP de `/api/v1/settings/special-status/` — Fase 29 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `route.ts`/`[id]/route.ts`."""

from datetime import date, datetime
from datetime import timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.models import SpecialStatus
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


def _valid_body(user_id: int, **overrides) -> dict:
    body = {
        "user_id": user_id,
        "type": "MATERNIDAD",
        "start_date": "2026-01-05",
        "daily_hours": 4,
        "limit_low": 2,
        "limit_base": 4,
        "limit_high": 5,
        "limit_overload": 6,
    }
    body.update(overrides)
    return body


# --- GET /settings/special-status/ --------------------------------------------------------


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/special-status/")
    assert response.status_code == 401


def test_get_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/special-status/")
    assert response.status_code == 403


def test_get_rejects_administrador_group_without_real_superuser():
    """Hallazgo H-5 de la auditoría de datos personales (ver
    docs/AUDIT_LOG.md § 2026-09-02): antes de esta corrección, un usuario
    en el grupo ADMINISTRADOR sin `is_superuser=True` (estado real
    alcanzable, ver docs/DECISIONS.md § 2026-09-01) pasaba este gate
    pero recibía la versión REDACTADA en KPIs — inconsistente."""
    user = _user_with_group("admin_solo_grupo", "ADMINISTRADOR")
    assert user.is_superuser is False
    response = _client_for(user).get("/api/v1/settings/special-status/")
    assert response.status_code == 403


def test_get_filters_by_user_id():
    admin = _superuser("admin")
    target = _user_with_group("analista", "ANALISTA_CC")
    other = _user_with_group("otro", "ANALISTA_CC")
    SpecialStatus.objects.create(
        user=target,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 1, 1),
        created_by=admin,
    )
    SpecialStatus.objects.create(
        user=other,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 1, 1),
        created_by=admin,
    )

    response = _client_for(admin).get(f"/api/v1/settings/special-status/?user_id={target.id}")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["user"]["name"] == "Ana"


# --- POST /settings/special-status/ -------------------------------------------------------


def test_post_requires_administrador():
    user = _user_with_group("jefe2", "JEFE_NACIONAL")
    target = _user_with_group("analista2", "ANALISTA_CC")
    response = _client_for(user).post(
        "/api/v1/settings/special-status/", _valid_body(target.id), format="json"
    )
    assert response.status_code == 403


def test_post_404_for_unknown_user():
    admin = _superuser("admin2")
    response = _client_for(admin).post(
        "/api/v1/settings/special-status/", _valid_body(999999), format="json"
    )
    assert response.status_code == 404


def test_post_400_for_hours_field_out_of_range():
    admin = _superuser("admin3")
    target = _user_with_group("analista3", "ANALISTA_CC")
    body = _valid_body(target.id, daily_hours=30)
    response = _client_for(admin).post("/api/v1/settings/special-status/", body, format="json")
    assert response.status_code == 400


def test_post_400_for_zero_hours():
    admin = _superuser("admin4")
    target = _user_with_group("analista4", "ANALISTA_CC")
    body = _valid_body(target.id, limit_low=0)
    response = _client_for(admin).post("/api/v1/settings/special-status/", body, format="json")
    assert response.status_code == 400


def test_post_400_for_non_monotonic_limits():
    admin = _superuser("admin5")
    target = _user_with_group("analista5", "ANALISTA_CC")
    body = _valid_body(target.id, limit_low=5, limit_base=4, limit_high=5, limit_overload=6)
    response = _client_for(admin).post("/api/v1/settings/special-status/", body, format="json")
    assert response.status_code == 400


def test_post_400_for_end_before_start():
    admin = _superuser("admin6")
    target = _user_with_group("analista6", "ANALISTA_CC")
    body = _valid_body(target.id, start_date="2026-01-10", end_date="2026-01-01")
    response = _client_for(admin).post("/api/v1/settings/special-status/", body, format="json")
    assert response.status_code == 400


def test_post_creates_special_status():
    admin = _superuser("admin7")
    target = _user_with_group("analista7", "ANALISTA_CC")
    response = _client_for(admin).post(
        "/api/v1/settings/special-status/", _valid_body(target.id), format="json"
    )
    assert response.status_code == 201
    assert response.data["dailyHours"] == 4
    assert response.data["isActive"] is True
    record = SpecialStatus.objects.get(user=target)
    assert record.created_by_id == admin.id


def test_post_allows_limit_base_equal_limit_high():
    admin = _superuser("admin8")
    target = _user_with_group("analista8", "ANALISTA_CC")
    body = _valid_body(target.id, limit_low=3, limit_base=5, limit_high=5, limit_overload=6)
    response = _client_for(admin).post("/api/v1/settings/special-status/", body, format="json")
    assert response.status_code == 201


# --- PATCH /settings/special-status/<id>/ (finalizar) -------------------------------------


def test_patch_requires_administrador():
    admin = _superuser("admin9")
    target = _user_with_group("analista9", "ANALISTA_CC")
    record = SpecialStatus.objects.create(
        user=target,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 1, 1),
        created_by=admin,
    )
    user = _user_with_group("jefe3", "JEFE_NACIONAL")
    response = _client_for(user).patch(f"/api/v1/settings/special-status/{record.id}/")
    assert response.status_code == 403


def test_patch_404_for_missing_record():
    admin = _superuser("admin10")
    response = _client_for(admin).patch("/api/v1/settings/special-status/999999/")
    assert response.status_code == 404


def test_patch_finalizes_open_ended_status_today():
    admin = _superuser("admin11")
    target = _user_with_group("analista10", "ANALISTA_CC")
    record = SpecialStatus.objects.create(
        user=target,
        type=SpecialStatus.Type.LACTANCIA,
        start_date=date(2026, 1, 1),
        end_date=None,
        created_by=admin,
    )
    with patch(
        "apps.configuration.views.timezone.now",
        return_value=datetime(2026, 3, 10, 12, 0, tzinfo=dt_timezone.utc),
    ):
        response = _client_for(admin).patch(f"/api/v1/settings/special-status/{record.id}/")
    assert response.status_code == 200
    assert response.data["isActive"] is False
    record.refresh_from_db()
    assert record.end_date == date(2026, 3, 10)


def test_patch_never_extends_a_past_end_date():
    admin = _superuser("admin12")
    target = _user_with_group("analista11", "ANALISTA_CC")
    record = SpecialStatus.objects.create(
        user=target,
        type=SpecialStatus.Type.LACTANCIA,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 15),
        created_by=admin,
    )
    with patch(
        "apps.configuration.views.timezone.now",
        return_value=datetime(2026, 3, 10, 12, 0, tzinfo=dt_timezone.utc),
    ):
        response = _client_for(admin).patch(f"/api/v1/settings/special-status/{record.id}/")
    assert response.status_code == 200
    record.refresh_from_db()
    assert record.end_date == date(2026, 1, 15)


# --- DELETE /settings/special-status/<id>/ ------------------------------------------------


def test_delete_requires_administrador():
    admin = _superuser("admin13")
    target = _user_with_group("analista12", "ANALISTA_CC")
    record = SpecialStatus.objects.create(
        user=target,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 1, 1),
        created_by=admin,
    )
    user = _user_with_group("jefe4", "JEFE_NACIONAL")
    response = _client_for(user).delete(f"/api/v1/settings/special-status/{record.id}/")
    assert response.status_code == 403


def test_delete_404_for_missing_record():
    admin = _superuser("admin14")
    response = _client_for(admin).delete("/api/v1/settings/special-status/999999/")
    assert response.status_code == 404


def test_delete_removes_record():
    admin = _superuser("admin15")
    target = _user_with_group("analista13", "ANALISTA_CC")
    record = SpecialStatus.objects.create(
        user=target,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 1, 1),
        created_by=admin,
    )
    response = _client_for(admin).delete(f"/api/v1/settings/special-status/{record.id}/")
    assert response.status_code == 200
    assert not SpecialStatus.objects.filter(pk=record.id).exists()
