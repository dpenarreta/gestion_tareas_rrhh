"""Cobertura HTTP de `/api/v1/settings/holidays/` — Fase 29 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de `route.ts`/`[id]/route.ts`."""

from datetime import date

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.models import Holiday
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


# --- GET /settings/holidays/ --------------------------------------------------------------


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/holidays/")
    assert response.status_code == 401


def test_get_does_not_require_administrador():
    """Cualquier autenticado puede consultar el calendario de feriados —
    corregido en la Fase 52 (ver docs/AUDIT_LOG.md § 2026-08-24), el
    `route.ts` original nunca restringió `GET`, solo `POST`/`DELETE`."""
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).get("/api/v1/settings/holidays/")
    assert response.status_code == 200


def test_get_lists_ordered_by_date():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    Holiday.objects.create(date=date(2026, 12, 25), name="Navidad", year=2026)
    Holiday.objects.create(date=date(2026, 1, 1), name="Año Nuevo", year=2026)

    response = _client_for(admin).get("/api/v1/settings/holidays/")
    assert response.status_code == 200
    assert [h["name"] for h in response.data] == ["Año Nuevo", "Navidad"]


def test_get_filters_by_year():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    Holiday.objects.create(date=date(2026, 1, 1), name="2026", year=2026)
    Holiday.objects.create(date=date(2027, 1, 1), name="2027", year=2027)

    response = _client_for(admin).get("/api/v1/settings/holidays/?year=2027")
    assert [h["name"] for h in response.data] == ["2027"]


# --- POST /settings/holidays/ -------------------------------------------------------------


def test_post_requires_administrador():
    user = _user_with_group("jefe2", "JEFE_NACIONAL")
    response = _client_for(user).post("/api/v1/settings/holidays/", {"date": "2026-05-01", "name": "Día del Trabajo"}, format="json")
    assert response.status_code == 403


def test_post_400_for_missing_fields():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).post("/api/v1/settings/holidays/", {"date": "2026-05-01"}, format="json")
    assert response.status_code == 400


def test_post_creates_holiday_deriving_year():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    response = _client_for(admin).post(
        "/api/v1/settings/holidays/", {"date": "2026-05-01", "name": "Día del Trabajo"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["year"] == 2026
    assert Holiday.objects.filter(date=date(2026, 5, 1), name="Día del Trabajo", year=2026).exists()


def test_post_409_for_duplicate_date():
    admin = _user_with_group("admin5", "ADMINISTRADOR")
    Holiday.objects.create(date=date(2026, 5, 1), name="Existente", year=2026)
    response = _client_for(admin).post(
        "/api/v1/settings/holidays/", {"date": "2026-05-01", "name": "Otro nombre"}, format="json"
    )
    assert response.status_code == 409


# --- DELETE /settings/holidays/<id>/ ------------------------------------------------------


def test_delete_requires_administrador():
    holiday = Holiday.objects.create(date=date(2026, 5, 1), name="Feriado", year=2026)
    user = _user_with_group("jefe3", "JEFE_NACIONAL")
    response = _client_for(user).delete(f"/api/v1/settings/holidays/{holiday.id}/")
    assert response.status_code == 403
    assert Holiday.objects.filter(pk=holiday.id).exists()


def test_delete_404_for_missing_holiday():
    admin = _user_with_group("admin7", "ADMINISTRADOR")
    response = _client_for(admin).delete("/api/v1/settings/holidays/999999/")
    assert response.status_code == 404


def test_delete_removes_holiday():
    admin = _user_with_group("admin8", "ADMINISTRADOR")
    holiday = Holiday.objects.create(date=date(2026, 5, 1), name="Feriado", year=2026)
    response = _client_for(admin).delete(f"/api/v1/settings/holidays/{holiday.id}/")
    assert response.status_code == 200
    assert not Holiday.objects.filter(pk=holiday.id).exists()
