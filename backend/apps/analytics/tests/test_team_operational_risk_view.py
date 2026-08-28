"""Cobertura HTTP de `GET /api/v1/analytics/operational-risk/team/` —
Fase 20 (ver docs/AUDIT_LOG.md § 2026-08-20), réplica de
`src/app/api/analytics/operational-risk/team/route.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def admin():
    user = User.objects.create_user(username="admin_role", email="admin_role@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    return user


@pytest.fixture
def jefe_nacional():
    user = User.objects.create_user(username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    return user


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!", first_name="Ana")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def asistente_seleccion():
    user = User.objects.create_user(username="asist_sel", email="asist_sel@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


def test_requires_authentication():
    response = APIClient().get("/api/v1/analytics/operational-risk/team/")
    assert response.status_code == 401


def test_requires_can_view_operational_risk(asistente_seleccion):
    response = _client_for(asistente_seleccion).get("/api/v1/analytics/operational-risk/team/")
    assert response.status_code == 403


def test_200_includes_subordinate_and_summary(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get("/api/v1/analytics/operational-risk/team/")
    assert response.status_code == 200
    entry = next(m for m in response.data["members"] if m["id"] == analista.id)
    assert entry["name"] == "Ana"
    assert entry["role"] == "ANALISTA_CC"
    for key in ("score", "classification", "classification_color", "factors"):
        assert key in entry
    assert sum(response.data["summary"].values()) == len(response.data["members"])
    assert response.data["engine_version"]
    assert "last_updated" in response.data


def test_excludes_leadership_roles(admin, jefe_nacional):
    response = _client_for(admin).get("/api/v1/analytics/operational-risk/team/")
    assert response.status_code == 200
    assert jefe_nacional.id not in [m["id"] for m in response.data["members"]]


def test_empty_response_shape_without_subordinates(admin):
    # ADMINISTRADOR no tiene subordinados EJECUTORES en el seed (solo
    # JEFE_NACIONAL, excluido por ser rol de liderazgo).
    response = _client_for(admin).get("/api/v1/analytics/operational-risk/team/")
    assert response.status_code == 200
    assert response.data["members"] == []
    assert response.data["summary"] == {"bajo": 0, "medio": 0, "alto": 0, "critico": 0}
