"""Cobertura HTTP de `/api/v1/settings/notification-rules/` — Fase 35
(ver docs/AUDIT_LOG.md § 2026-08-21), réplica de `route.ts`. Solo se
porta la superficie de configuración — los consumidores reales
(`CommentService.create_comment`/`RETROACTIVE_NOTIFY_ROLES`) siguen
sin conectarse, ver gap documentado en `services.py`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.configuration.services import get_effective_notification_rules
from apps.hierarchy.services import ALL_ROLES
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


# --- GET /settings/notification-rules/ -----------------------------------------------------


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/notification-rules/")
    assert response.status_code == 401


def test_get_defaults_match_current_hierarchy_and_hardcoded_behavior():
    user = _user_with_group("analista", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/notification-rules/")
    assert response.status_code == 200
    assert set(response.data["comment_targets"].keys()) == set(ALL_ROLES)
    assert response.data["first_comment_role"] is None
    # Mismo default hardcodeado que `RETROACTIVE_NOTIFY_ROLES` en
    # `apps/tasks/services.py` — coinciden a propósito.
    assert response.data["retroactive_notify_roles"] == ["COORDINADOR_NACIONAL"]


# --- PUT /settings/notification-rules/ ------------------------------------------------------


def _valid_body(**overrides) -> dict:
    body = {"comment_targets": {}, "first_comment_role": None, "retroactive_notify_roles": []}
    body.update(overrides)
    return body


def test_put_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).put("/api/v1/settings/notification-rules/", _valid_body(), format="json")
    assert response.status_code == 403


def test_put_400_when_comment_targets_missing():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    body = _valid_body()
    del body["comment_targets"]
    response = _client_for(admin).put("/api/v1/settings/notification-rules/", body, format="json")
    assert response.status_code == 400


def test_put_400_when_first_comment_role_key_omitted():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    body = _valid_body()
    del body["first_comment_role"]
    response = _client_for(admin).put("/api/v1/settings/notification-rules/", body, format="json")
    assert response.status_code == 400


def test_put_400_when_retroactive_notify_roles_missing():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    body = _valid_body()
    del body["retroactive_notify_roles"]
    response = _client_for(admin).put("/api/v1/settings/notification-rules/", body, format="json")
    assert response.status_code == 400


def test_put_400_for_unknown_role_as_comment_targets_key():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    body = _valid_body(comment_targets={"NO_EXISTE": ["ADMINISTRADOR"]})
    response = _client_for(admin).put("/api/v1/settings/notification-rules/", body, format="json")
    assert response.status_code == 400


def test_put_400_for_unknown_role_in_comment_targets_value():
    admin = _user_with_group("admin5", "ADMINISTRADOR")
    body = _valid_body(comment_targets={"ANALISTA_CC": ["NO_EXISTE"]})
    response = _client_for(admin).put("/api/v1/settings/notification-rules/", body, format="json")
    assert response.status_code == 400


def test_put_400_for_invalid_first_comment_role():
    admin = _user_with_group("admin6", "ADMINISTRADOR")
    body = _valid_body(first_comment_role="NO_EXISTE")
    response = _client_for(admin).put("/api/v1/settings/notification-rules/", body, format="json")
    assert response.status_code == 400


def test_put_400_for_non_list_retroactive_notify_roles():
    admin = _user_with_group("admin7", "ADMINISTRADOR")
    body = _valid_body(retroactive_notify_roles="ADMINISTRADOR")
    response = _client_for(admin).put("/api/v1/settings/notification-rules/", body, format="json")
    assert response.status_code == 400


def test_put_saves_and_persists_custom_rules():
    admin = _user_with_group("admin8", "ADMINISTRADOR")
    body = {
        "comment_targets": {"ANALISTA_CC": ["COORDINADOR_ZS", "JEFE_NACIONAL"]},
        "first_comment_role": "COORDINADOR_NACIONAL",
        "retroactive_notify_roles": ["ADMINISTRADOR"],
    }
    response = _client_for(admin).put("/api/v1/settings/notification-rules/", body, format="json")
    assert response.status_code == 200
    assert response.data == body

    get_response = _client_for(admin).get("/api/v1/settings/notification-rules/")
    assert get_response.data == body


def test_saved_rules_do_not_fall_back_to_hierarchy_defaults():
    """Réplica fiel de la semántica `??` del TS: una vez que existe un
    registro guardado, los campos AUSENTES en ese registro caen a
    vacío, nunca al default basado en jerarquía — aunque acá se guarda
    explícitamente vacío, el resultado (comment_targets == {}) prueba
    que el motor no reconstruye el default de jerarquía una vez que
    hay algo guardado."""
    admin = _user_with_group("admin9", "ADMINISTRADOR")
    _client_for(admin).put("/api/v1/settings/notification-rules/", _valid_body(), format="json")

    result = get_effective_notification_rules()
    assert result == {"comment_targets": {}, "first_comment_role": None, "retroactive_notify_roles": []}
