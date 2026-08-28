"""Cobertura HTTP de `GET /api/v1/analytics/benchmarks/<id>/` — Fase 22
(ver docs/AUDIT_LOG.md § 2026-08-20), réplica de
`src/app/api/analytics/benchmarks/[userId]/route.ts`. Compone sobre
`apps.analytics.benchmark`, ya cubierto por sus propios tests
unitarios (`test_benchmark.py`) — se prueba con datos reales para
validar el ensamblado HTTP/auth/visibilidad y la forma de la
respuesta."""

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
def analista():
    user = _user_with_group("analista", "ANALISTA_CC")
    user.first_name = "Ana"
    user.save(update_fields=["first_name"])
    return user


@pytest.fixture
def coordinador_nacional():
    return _user_with_group("coord_nac", "COORDINADOR_NACIONAL")


@pytest.fixture
def asistente_seleccion():
    return _user_with_group("asist_sel", "ASISTENTE_SELECCION")


def test_requires_authentication():
    response = APIClient().get("/api/v1/analytics/benchmarks/1/")
    assert response.status_code == 401


def test_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/analytics/benchmarks/999999/")
    assert response.status_code == 404


def test_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = _user_with_group("peer", "ASISTENTE_GH")
    response = _client_for(asistente_seleccion).get(f"/api/v1/analytics/benchmarks/{other_peer.id}/")
    assert response.status_code == 403


def test_200_for_self_personal_mode_includes_expected_shape(analista):
    """`analista` es la única `ANALISTA_CC` en esta BD de test → modo
    "personal" (sin pares)."""
    response = _client_for(analista).get(f"/api/v1/analytics/benchmarks/{analista.id}/")
    assert response.status_code == 200
    assert response.data["benchmark"]["mode"] == "personal"
    assert response.data["benchmark"]["performance"]["mode"] == "personal"
    assert response.data["evolution"]["available"] is False
    assert response.data["confidence"]["reliability_pct"] == 30
    assert "data_quality_pct" in response.data["confidence"]
    assert "last_updated" in response.data


def test_200_for_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get(f"/api/v1/analytics/benchmarks/{analista.id}/")
    assert response.status_code == 200
    assert response.data["benchmark"]["mode"] == "personal"


def test_cargo_mode_reliability_pct_is_fixed_92(analista):
    _user_with_group("peer1", "ANALISTA_CC")
    _user_with_group("peer2", "ANALISTA_CC")
    _user_with_group("peer3", "ANALISTA_CC")

    response = _client_for(analista).get(f"/api/v1/analytics/benchmarks/{analista.id}/")
    assert response.status_code == 200
    assert response.data["benchmark"]["mode"] == "cargo"
    assert response.data["confidence"]["reliability_pct"] == 92
