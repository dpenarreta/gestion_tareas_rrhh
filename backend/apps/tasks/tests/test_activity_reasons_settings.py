"""Cobertura HTTP de `POST /settings/activity-reasons/` y `PATCH
/settings/activity-reasons/<id>/` — Fase 30 (ver docs/AUDIT_LOG.md §
2026-08-21), réplica de `route.ts`/`[id]/route.ts`."""

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.tasks.models import ActivityReason
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


# --- POST /settings/activity-reasons/ -----------------------------------------------------


def test_post_requires_authentication():
    response = APIClient().post(
        "/api/v1/settings/activity-reasons/", {"label": "Reunión", "assigned_roles": ["ANALISTA_CC"]}, format="json"
    )
    assert response.status_code == 401


def test_post_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).post(
        "/api/v1/settings/activity-reasons/", {"label": "Reunión", "assigned_roles": ["ANALISTA_CC"]}, format="json"
    )
    assert response.status_code == 403
    assert ActivityReason.objects.count() == 0


def test_post_400_for_blank_label():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    response = _client_for(admin).post(
        "/api/v1/settings/activity-reasons/", {"label": "   ", "assigned_roles": ["ANALISTA_CC"]}, format="json"
    )
    assert response.status_code == 400


def test_post_400_for_empty_assigned_roles():
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    response = _client_for(admin).post(
        "/api/v1/settings/activity-reasons/", {"label": "Reunión", "assigned_roles": []}, format="json"
    )
    assert response.status_code == 400


def test_post_400_for_unknown_role():
    admin = _user_with_group("admin3", "ADMINISTRADOR")
    response = _client_for(admin).post(
        "/api/v1/settings/activity-reasons/", {"label": "Reunión", "assigned_roles": ["NO_EXISTE"]}, format="json"
    )
    assert response.status_code == 400


def test_post_creates_with_slugified_key():
    admin = _user_with_group("admin4", "ADMINISTRADOR")
    response = _client_for(admin).post(
        "/api/v1/settings/activity-reasons/",
        {"label": "Reunión de Área", "assigned_roles": ["ANALISTA_CC"]},
        format="json",
    )
    assert response.status_code == 201
    assert response.data["key"] == "REUNION_DE_AREA"
    assert response.data["label"] == "Reunión de Área"
    assert response.data["description"] == ""


def test_post_deduplicates_key_with_numeric_suffix():
    admin = _user_with_group("admin5", "ADMINISTRADOR")
    ActivityReason.objects.create(key="REUNION", label="Reunión", assigned_roles=["ANALISTA_CC"])

    response = _client_for(admin).post(
        "/api/v1/settings/activity-reasons/", {"label": "Reunión", "assigned_roles": ["ANALISTA_CC"]}, format="json"
    )
    assert response.status_code == 201
    assert response.data["key"] == "REUNION_2"


def test_post_key_falls_back_to_motivo_for_symbols_only_label():
    admin = _user_with_group("admin6", "ADMINISTRADOR")
    response = _client_for(admin).post(
        "/api/v1/settings/activity-reasons/", {"label": "@@@", "assigned_roles": ["ANALISTA_CC"]}, format="json"
    )
    assert response.status_code == 201
    assert response.data["key"] == "MOTIVO"


def test_post_trims_description_and_defaults_to_empty_string():
    admin = _user_with_group("admin7", "ADMINISTRADOR")
    response = _client_for(admin).post(
        "/api/v1/settings/activity-reasons/",
        {"label": "Reunión", "description": "  Detalle  ", "assigned_roles": ["ANALISTA_CC"]},
        format="json",
    )
    assert response.data["description"] == "Detalle"

    response2 = _client_for(admin).post(
        "/api/v1/settings/activity-reasons/", {"label": "Otra", "assigned_roles": ["ANALISTA_CC"]}, format="json"
    )
    assert response2.data["description"] == ""


# --- PATCH /settings/activity-reasons/<id>/ -----------------------------------------------


def test_patch_requires_authentication():
    reason = ActivityReason.objects.create(key="REUNION", label="Reunión", assigned_roles=["ANALISTA_CC"])
    response = APIClient().patch(f"/api/v1/settings/activity-reasons/{reason.id}/", {"label": "Nuevo"}, format="json")
    assert response.status_code == 401


def test_patch_requires_administrador():
    reason = ActivityReason.objects.create(key="REUNION", label="Reunión", assigned_roles=["ANALISTA_CC"])
    user = _user_with_group("jefe2", "JEFE_NACIONAL")
    response = _client_for(user).patch(
        f"/api/v1/settings/activity-reasons/{reason.id}/", {"label": "Nuevo"}, format="json"
    )
    assert response.status_code == 403


def test_patch_404_for_missing_reason():
    admin = _user_with_group("admin8", "ADMINISTRADOR")
    response = _client_for(admin).patch("/api/v1/settings/activity-reasons/999999/", {"label": "Nuevo"}, format="json")
    assert response.status_code == 404


def test_patch_400_for_blank_label():
    admin = _user_with_group("admin9", "ADMINISTRADOR")
    reason = ActivityReason.objects.create(key="REUNION", label="Reunión", assigned_roles=["ANALISTA_CC"])
    response = _client_for(admin).patch(
        f"/api/v1/settings/activity-reasons/{reason.id}/", {"label": "   "}, format="json"
    )
    assert response.status_code == 400


def test_patch_updates_only_provided_fields():
    admin = _user_with_group("admin10", "ADMINISTRADOR")
    reason = ActivityReason.objects.create(
        key="REUNION", label="Reunión", description="Original", assigned_roles=["ANALISTA_CC"]
    )
    response = _client_for(admin).patch(
        f"/api/v1/settings/activity-reasons/{reason.id}/", {"label": "Reunión Semanal"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["label"] == "Reunión Semanal"
    assert response.data["description"] == "Original"
    assert response.data["assigned_roles"] == ["ANALISTA_CC"]


def test_patch_updates_assigned_roles():
    admin = _user_with_group("admin11", "ADMINISTRADOR")
    reason = ActivityReason.objects.create(key="REUNION", label="Reunión", assigned_roles=["ANALISTA_CC"])
    response = _client_for(admin).patch(
        f"/api/v1/settings/activity-reasons/{reason.id}/",
        {"assigned_roles": ["COORDINADOR_ZS", "JEFE_NACIONAL"]},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["assigned_roles"] == ["COORDINADOR_ZS", "JEFE_NACIONAL"]


def test_patch_archiving_forces_inactive_and_sets_archived_at():
    admin = _user_with_group("admin12", "ADMINISTRADOR")
    reason = ActivityReason.objects.create(key="REUNION", label="Reunión", assigned_roles=["ANALISTA_CC"])
    response = _client_for(admin).patch(
        f"/api/v1/settings/activity-reasons/{reason.id}/", {"is_archived": True}, format="json"
    )
    assert response.status_code == 200
    assert response.data["is_archived"] is True
    assert response.data["is_active"] is False
    assert response.data["archived_at"] is not None


def test_patch_unarchiving_does_not_reactivate():
    admin = _user_with_group("admin13", "ADMINISTRADOR")
    reason = ActivityReason.objects.create(
        key="REUNION", label="Reunión", assigned_roles=["ANALISTA_CC"],
        is_archived=True, is_active=False, archived_at=timezone.now(),
    )
    response = _client_for(admin).patch(
        f"/api/v1/settings/activity-reasons/{reason.id}/", {"is_archived": False}, format="json"
    )
    assert response.status_code == 200
    assert response.data["is_archived"] is False
    assert response.data["archived_at"] is None
    # Réplica fiel: restaurar NO reactiva la selectabilidad automáticamente.
    assert response.data["is_active"] is False
