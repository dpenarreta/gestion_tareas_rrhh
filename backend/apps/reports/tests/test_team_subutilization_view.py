"""Cobertura HTTP de `POST /api/v1/reports/executive/team-subutilization/`
— Fase 85 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-27).
Predicción de subutilización para un roster explícito de usuarios,
reutilizando `compute_subutilizacion_predictions` (`apps.analytics`) tal
cual — a diferencia de `apps.analytics.views.TeamSubutilizationView`
(GET, deriva la lista del equipo jerárquico visible del actor), acá el
caller pasa `user_ids` explícitos, mismo criterio que
`MonthlyTeamReportView` (Fase 68)."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str, *, first_name: str = "") -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!", first_name=first_name)
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def test_requires_authentication():
    response = APIClient().post("/api/v1/reports/executive/team-subutilization/", {"user_ids": []}, format="json")
    assert response.status_code == 401


def test_requires_can_access_reports():
    user = _user_with_group("coordzs", "COORDINADOR_ZS")
    response = _client_for(user).post("/api/v1/reports/executive/team-subutilization/", {"user_ids": []}, format="json")
    assert response.status_code == 403


def test_400_for_missing_user_ids():
    jefe = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(jefe).post("/api/v1/reports/executive/team-subutilization/", {}, format="json")
    assert response.status_code == 400


def test_returns_empty_predictions_for_empty_roster():
    jefe = _user_with_group("jefe2", "JEFE_NACIONAL")
    response = _client_for(jefe).post("/api/v1/reports/executive/team-subutilization/", {"user_ids": []}, format="json")
    assert response.status_code == 200
    assert response.data == {"predictions": {}}


def test_returns_prediction_keyed_by_id_for_roster_member():
    jefe = _user_with_group("jefe3", "JEFE_NACIONAL")
    ana = _user_with_group("ana", "ASISTENTE_GH", first_name="Ana")
    response = _client_for(jefe).post("/api/v1/reports/executive/team-subutilization/", {"user_ids": [ana.id]}, format="json")
    assert response.status_code == 200
    predictions = response.data["predictions"]
    assert ana.id in predictions
    assert set(predictions[ana.id]) >= {"nivel", "confidence_pct", "horizon"}


def test_accepts_explicit_as_of():
    jefe = _user_with_group("jefe4", "JEFE_NACIONAL")
    response = _client_for(jefe).post(
        "/api/v1/reports/executive/team-subutilization/",
        {"user_ids": [], "as_of": "2026-06-15T00:00:00Z"},
        format="json",
    )
    assert response.status_code == 200


def test_coordinador_nacional_can_access():
    coord = _user_with_group("coordnac", "COORDINADOR_NACIONAL")
    response = _client_for(coord).post("/api/v1/reports/executive/team-subutilization/", {"user_ids": []}, format="json")
    assert response.status_code == 200


def test_does_not_depend_on_actor_hierarchy():
    # A diferencia de apps.analytics.views.TeamSubutilizationView: un
    # ADMINISTRADOR sin relación jerárquica directa con `ana` igual
    # puede pedir su predicción — el roster lo define el caller, no la
    # jerarquía del actor.
    admin = _user_with_group("admin", "ADMINISTRADOR")
    ana = _user_with_group("ana2", "ASISTENTE_GH", first_name="Ana")
    response = _client_for(admin).post("/api/v1/reports/executive/team-subutilization/", {"user_ids": [ana.id]}, format="json")
    assert response.status_code == 200
    assert ana.id in response.data["predictions"]
