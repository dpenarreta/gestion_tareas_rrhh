"""Cobertura de `PATCH /api/v1/auth/consent/` — Fase 13 (ver
docs/AUDIT_LOG.md § 2026-08-19), réplica de `PATCH /api/auth/consent`."""

import pytest
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client():
    return APIClient()


def test_accept_consent_requires_authentication(api_client):
    response = api_client.patch("/api/v1/auth/consent/")
    assert response.status_code == 401


def test_accept_consent_sets_flag_and_timestamp(api_client):
    user = User.objects.create_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    assert user.data_consent_accepted is False
    api_client.force_authenticate(user=user)

    response = api_client.patch("/api/v1/auth/consent/")

    assert response.status_code == 200
    assert response.data["data_consent_accepted"] is True
    assert response.data["data_consent_accepted_at"] is not None
    user.refresh_from_db()
    assert user.data_consent_accepted is True
    assert user.data_consent_accepted_at is not None


def test_accept_consent_only_affects_the_authenticated_user(api_client):
    user = User.objects.create_user(
        username="ada2", email="ada2@example.com", password="Sup3r-Secr3t!"
    )
    other = User.objects.create_user(
        username="other", email="other@example.com", password="Sup3r-Secr3t!"
    )
    api_client.force_authenticate(user=user)

    api_client.patch("/api/v1/auth/consent/")

    other.refresh_from_db()
    assert other.data_consent_accepted is False


def test_accept_consent_queda_registrado_en_la_auditoria(api_client):
    # El campo `data_consent_accepted_at` es un único valor y `reset_consent`
    # lo pone en None: sin este registro, un reseteo administrativo borra la
    # única prueba de que la persona consintió (LOPDP). Pasó en producción el
    # 2026-09-14.
    user = User.objects.create_user(
        username="ada3", email="ada3@example.com", password="Sup3r-Secr3t!"
    )
    api_client.force_authenticate(user=user)

    api_client.patch("/api/v1/auth/consent/")

    evento = AuditLog.objects.get(action="user.consent_accepted")
    assert evento.actor == user
    assert evento.target_id == str(user.pk)
    assert evento.new_values["data_consent_accepted"] is True
    assert evento.new_values["data_consent_accepted_at"]


def test_la_auditoria_sobrevive_al_reseteo_administrativo(api_client):
    # El punto entero del cambio: después de un reseteo, el usuario queda sin
    # marca ni fecha, pero tiene que seguir constando QUE aceptó y CUÁNDO.
    from apps.users.services import UserAdminService

    admin = User.objects.create_user(
        username="jefa", email="jefa@example.com", password="Sup3r-Secr3t!"
    )
    user = User.objects.create_user(
        username="ada4", email="ada4@example.com", password="Sup3r-Secr3t!"
    )
    api_client.force_authenticate(user=user)
    api_client.patch("/api/v1/auth/consent/")

    UserAdminService.reset_consent(user=user, actor=admin)

    user.refresh_from_db()
    assert user.data_consent_accepted is False
    assert user.data_consent_accepted_at is None
    evento = AuditLog.objects.get(action="user.consent_accepted")
    assert evento.new_values["data_consent_accepted_at"]
