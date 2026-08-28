"""Cobertura de `GET /api/v1/reports/monthly-report/` — Fase 89 de la
migración de stack (ver docs/AUDIT_LOG.md § 2026-08-28). Réplica del
último `prisma.monthlyReport.findUnique` de `buildSnapshotData.ts`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.reports.models import MonthlyReport
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def jefe():
    user = User.objects.create_user(username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    return user


@pytest.fixture
def sin_acceso():
    user = User.objects.create_user(username="ana", email="ana@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


def test_requiere_autenticacion():
    response = APIClient().get("/api/v1/reports/monthly-report/?month=7&year=2026&scope=JEFE")
    assert response.status_code == 401


def test_solo_can_access_reports(sin_acceso):
    response = _client_for(sin_acceso).get("/api/v1/reports/monthly-report/?month=7&year=2026&scope=JEFE")
    assert response.status_code == 403


def test_404_si_no_existe_ninguna_fila_hoy_siempre_es_asi(jefe):
    """Ningún código actual escribe `MonthlyReport` — este caso es el
    único que ocurre en la práctica hasta que algo empiece a escribirlo."""
    response = _client_for(jefe).get("/api/v1/reports/monthly-report/?month=7&year=2026&scope=JEFE")
    assert response.status_code == 404


def test_400_con_parametros_invalidos(jefe):
    client = _client_for(jefe)
    assert client.get("/api/v1/reports/monthly-report/?month=x&year=2026&scope=JEFE").status_code == 400
    assert client.get("/api/v1/reports/monthly-report/?month=7&year=2026&scope=INVALIDO").status_code == 400


def test_devuelve_data_si_existe_una_fila(jefe):
    MonthlyReport.objects.create(
        month=7, year=2026, scope="JEFE", generated_by=jefe, data={"indiceEjecutivo": {"valor": 82.5}}
    )
    response = _client_for(jefe).get("/api/v1/reports/monthly-report/?month=7&year=2026&scope=JEFE")
    assert response.status_code == 200
    assert response.data["data"] == {"indiceEjecutivo": {"valor": 82.5}}
