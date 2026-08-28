"""Cobertura HTTP de `GET /api/v1/analytics/recommendations/team/` —
Fase 24 (ver docs/AUDIT_LOG.md § 2026-08-20), réplica de
`src/app/api/analytics/recommendations/team/route.ts`. Compone sobre
`apps.analytics.recommendations`, ya cubierto por sus propios tests
unitarios (`test_recommendations.py`) — se prueba con datos reales
para validar el ensamblado HTTP/auth/visibilidad."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

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


@pytest.fixture
def coordinador_nacional():
    return _user_with_group("coord_nac", "COORDINADOR_NACIONAL")


@pytest.fixture
def admin():
    return _user_with_group("admin_role", "ADMINISTRADOR")


@pytest.fixture
def jefe_nacional():
    return _user_with_group("jefe", "JEFE_NACIONAL")


@pytest.fixture
def asistente_seleccion():
    return _user_with_group("asist_sel", "ASISTENTE_SELECCION")


def test_requires_authentication():
    response = APIClient().get("/api/v1/analytics/recommendations/team/")
    assert response.status_code == 401


def test_requires_can_view_operational_risk(asistente_seleccion):
    response = _client_for(asistente_seleccion).get("/api/v1/analytics/recommendations/team/")
    assert response.status_code == 403


def test_200_includes_expected_shape(coordinador_nacional):
    response = _client_for(coordinador_nacional).get("/api/v1/analytics/recommendations/team/")
    assert response.status_code == 200
    for key in ("recommendations", "prioritized", "engine_version", "last_updated"):
        assert key in response.data
    assert set(response.data["prioritized"]) == {"top", "additional"}


def test_excludes_leadership_roles(admin, jefe_nacional):
    """JEFE_NACIONAL (nivel 4) no debe aparecer como miembro evaluado
    del actor Administrador — mismo filtro `isExecutorRole` que
    `kpis/team`/`operational-risk/team` (Fases 19/20)."""
    response = _client_for(admin).get("/api/v1/analytics/recommendations/team/")
    assert response.status_code == 200
    recommended_ids = {r["id"] for r in response.data["recommendations"]}
    assert jefe_nacional.id not in recommended_ids


def test_empty_recommendations_without_real_subordinates(coordinador_nacional):
    """En esta BD de test solo existe el actor — `get_subordinate_executor_groups`
    devuelve grupos válidos, pero no hay usuarios reales en ellos, así
    que `compute_team_recommendations` recibe menos de 2 miembros."""
    response = _client_for(coordinador_nacional).get("/api/v1/analytics/recommendations/team/")
    assert response.data["recommendations"] == []
    assert response.data["prioritized"] == {"top": [], "additional": []}
