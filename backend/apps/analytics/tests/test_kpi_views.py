"""Cobertura HTTP de `/api/v1/kpis/me/` y `/api/v1/kpis/<user_id>/` —
Fase 4b (ver docs/AUDIT_LOG.md § 2026-08-11), réplica de los casos de
borde ya verificados por `kpis-me-userid.test.ts` legacy."""

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.configuration.models import LeaveRecord
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def admin():
    admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    admin.is_superuser = True
    admin.save()
    return admin


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def asistente_seleccion():
    user = User.objects.create_user(username="asist_sel", email="asist_sel@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


def test_kpi_me_returns_200_for_self(analista):
    response = _client_for(analista).get("/api/v1/kpis/me/")
    assert response.status_code == 200
    assert response.data["user"]["id"] == analista.id


def test_kpi_me_requires_authentication():
    response = APIClient().get("/api/v1/kpis/me/")
    assert response.status_code == 401


def test_kpi_user_404_for_missing_user(analista):
    response = _client_for(analista).get("/api/v1/kpis/999999/")
    assert response.status_code == 404


def test_kpi_user_403_for_peer_outside_hierarchy(asistente_seleccion):
    other_peer = User.objects.create_user(username="peer", email="peer@example.com", password="Sup3r-Secr3t!")
    other_peer.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    response = _client_for(asistente_seleccion).get(f"/api/v1/kpis/{other_peer.id}/")
    assert response.status_code == 403


def test_kpi_user_200_for_visible_subordinate(coordinador_nacional, analista):
    response = _client_for(coordinador_nacional).get(f"/api/v1/kpis/{analista.id}/")
    assert response.status_code == 200
    assert response.data["user"]["id"] == analista.id


def test_kpi_user_redacts_sensitive_detail_for_hierarchical_superior(coordinador_nacional, analista, admin):
    today = timezone.now().date()
    LeaveRecord.objects.create(user=analista, type=LeaveRecord.Type.MEDICO, date=today, is_full_day=True, created_by=admin)

    superior_response = _client_for(coordinador_nacional).get(f"/api/v1/kpis/{analista.id}/")
    assert superior_response.status_code == 200
    assert superior_response.data["carga_tiempo"]["diaria"]["medico_leave_full_day"] is False
    assert superior_response.data["carga_tiempo"]["sensitive_detail_visible"] is False


def test_kpi_user_no_redaction_for_administrator(analista, admin):
    today = timezone.now().date()
    LeaveRecord.objects.create(user=analista, type=LeaveRecord.Type.MEDICO, date=today, is_full_day=True, created_by=admin)

    admin_response = _client_for(admin).get(f"/api/v1/kpis/{analista.id}/")
    assert admin_response.status_code == 200
    assert admin_response.data["carga_tiempo"]["diaria"]["medico_leave_full_day"] is True
    assert admin_response.data["carga_tiempo"]["sensitive_detail_visible"] is True


def test_kpi_user_no_redaction_for_self(analista, admin):
    today = timezone.now().date()
    LeaveRecord.objects.create(user=analista, type=LeaveRecord.Type.MEDICO, date=today, is_full_day=True, created_by=admin)

    self_response = _client_for(analista).get(f"/api/v1/kpis/{analista.id}/")
    assert self_response.status_code == 200
    assert self_response.data["carga_tiempo"]["diaria"]["medico_leave_full_day"] is True
