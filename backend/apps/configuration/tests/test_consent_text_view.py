"""Cobertura HTTP de `/api/v1/settings/consent-text/` — pedido explícito
del usuario (ver docs/AUDIT_LOG.md § 2026-09-02, "Consentimiento de datos
editable desde Ajustes"), mismo patrón que `test_welcome_message_view.py`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import CONFIG_KEY_CONSENT_TEXT, DEFAULT_CONSENT_TEXT
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!"
    )
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/consent-text/")
    assert response.status_code == 401


def test_get_defaults_to_the_previously_hardcoded_text_for_any_authenticated_role():
    # A diferencia de la mayoría de settings/*, CUALQUIER usuario autenticado
    # necesita poder leer esto — es lo que ConsentGate.tsx le muestra a
    # todo el mundo antes de dejarlo entrar, no solo a Administrador.
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/consent-text/")
    assert response.status_code == 200
    assert response.data == {"text": DEFAULT_CONSENT_TEXT}


def test_put_403_for_non_administrator():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put(
        "/api/v1/settings/consent-text/", {"text": "Nuevo texto"}, format="json"
    )
    assert response.status_code == 403


def test_put_400_for_missing_field():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/consent-text/", {}, format="json")
    assert response.status_code == 400


def test_put_400_for_blank_text():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/consent-text/", {"text": "   "}, format="json"
    )
    assert response.status_code == 400


def test_put_updates_text_for_administrator_and_get_reflects_it():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).put(
        "/api/v1/settings/consent-text/",
        {"text": "  Texto nuevo del aviso legal.  "},
        format="json",
    )
    assert response.status_code == 200
    assert response.data == {"text": "Texto nuevo del aviso legal."}
    assert SystemConfigHistory.objects.filter(
        key=CONFIG_KEY_CONSENT_TEXT, value="Texto nuevo del aviso legal."
    ).exists()

    get_response = _client_for(admin).get("/api/v1/settings/consent-text/")
    assert get_response.data == {"text": "Texto nuevo del aviso legal."}


def test_put_stores_text_longer_than_the_old_255_char_limit():
    """Hallazgo real (ver docs/AUDIT_LOG.md § 2026-09-02):
    `SystemConfigHistory.value` era `CharField(max_length=255)` —
    insuficiente para el texto completo del aviso. Confirma que la
    migración a `TextField` realmente levantó el límite."""
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    long_text = "Párrafo largo. " * 50  # ~750 caracteres, > 255
    assert len(long_text) > 255
    response = _client_for(admin).put(
        "/api/v1/settings/consent-text/", {"text": long_text}, format="json"
    )
    assert response.status_code == 200
    assert response.data["text"] == long_text.strip()
