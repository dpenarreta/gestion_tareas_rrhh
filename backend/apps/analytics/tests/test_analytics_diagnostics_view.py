"""Cobertura de `GET /api/v1/analytics/diagnostics/` — Fase 88 de la
migración de stack (ver docs/AUDIT_LOG.md § 2026-08-28). Réplica de los
2 cálculos que `/api/analytics/diagnostics` (TS, panel "Diagnóstico del
Motor") seguía resolviendo contra Prisma: `computeDataQuality` y
`recordEngineVersionIfChanged`."""

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
def admin():
    user = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    return user


@pytest.fixture
def sin_acceso():
    user = User.objects.create_user(username="ana", email="ana@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


def test_requiere_autenticacion():
    response = APIClient().get("/api/v1/analytics/diagnostics/")
    assert response.status_code == 401


def test_solo_administrador(sin_acceso):
    response = _client_for(sin_acceso).get("/api/v1/analytics/diagnostics/")
    assert response.status_code == 403


def test_calidad_de_datos_sin_tareas_solo_penaliza_horas_efectivas_sin_configurar(admin):
    """Sin tareas, los 3 primeros checks dan 0 issues — el único que
    queda es `sin_horas_config` (peso 10, `HORAS_EFECTIVAS_DIA` nunca
    configurada en este test), igual que `compute_data_quality` sola
    (`apps/analytics/tests/test_data_quality.py`)."""
    response = _client_for(admin).get("/api/v1/analytics/diagnostics/?engine_version=1.5.0")
    assert response.status_code == 200
    assert response.data["data_quality_pct"] == 90


def test_primera_vez_registra_la_version_como_cambio_sin_version_previa(admin):
    response = _client_for(admin).get("/api/v1/analytics/diagnostics/?engine_version=1.5.0")
    assert response.status_code == 200
    assert response.data["version_change"] == {"previous_version": None, "changed": True}


def test_misma_version_no_reporta_cambio_la_segunda_vez(admin):
    client = _client_for(admin)
    client.get("/api/v1/analytics/diagnostics/?engine_version=1.5.0")

    response = client.get("/api/v1/analytics/diagnostics/?engine_version=1.5.0")

    assert response.data["version_change"] == {"previous_version": "1.5.0", "changed": False}


def test_version_distinta_registra_el_cambio(admin):
    client = _client_for(admin)
    client.get("/api/v1/analytics/diagnostics/?engine_version=1.5.0")

    response = client.get("/api/v1/analytics/diagnostics/?engine_version=1.6.0")

    assert response.data["version_change"] == {"previous_version": "1.5.0", "changed": True}
