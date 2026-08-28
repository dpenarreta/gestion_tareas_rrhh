"""Cobertura HTTP de `/api/v1/desk-reminders/` — Fase 7b (ver
docs/AUDIT_LOG.md § 2026-08-17): CRUD core de Recordatorios de
Escritorio Digital, sin adjuntos/`convert-to-task` todavía, y SIN
cutover de `route.ts` (esta ruta no tiene consumidor real en Next.js
en esta sub-fase)."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.desk.models import DeskAuditLog, PersonalReminder
from apps.notifications.models import Notification
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def owner():
    user = User.objects.create_user(username="ana", email="ana@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def stranger():
    user = User.objects.create_user(username="bruno", email="bruno@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


@pytest.fixture
def admin():
    user = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    return user


def _create_reminder(*, owner: User, **overrides) -> PersonalReminder:
    due_at = (timezone.now() + timedelta(days=1)).isoformat()
    payload = {"title": "Enviar informe mensual", "due_at": due_at}
    payload.update(overrides)
    response = _client_for(owner).post("/api/v1/desk-reminders/", payload, format="json")
    assert response.status_code == 201, response.data
    return PersonalReminder.objects.get(id=response.data["id"])


# --- Creación ------------------------------------------------------------------------


def test_owner_creates_reminder(owner):
    due_at = (timezone.now() + timedelta(hours=2)).isoformat()
    response = _client_for(owner).post(
        "/api/v1/desk-reminders/", {"title": "Llamar al proveedor", "due_at": due_at}, format="json"
    )
    assert response.status_code == 201
    assert response.data["title"] == "Llamar al proveedor"
    assert response.data["priority"] == "MEDIA"
    assert response.data["repeat"] == "UNA_VEZ"
    assert response.data["status"] == "PENDIENTE"


def test_admin_cannot_create_reminders(admin):
    due_at = (timezone.now() + timedelta(hours=2)).isoformat()
    response = _client_for(admin).post("/api/v1/desk-reminders/", {"title": "X", "due_at": due_at}, format="json")
    assert response.status_code == 403


def test_missing_title_returns_400(owner):
    due_at = (timezone.now() + timedelta(hours=2)).isoformat()
    response = _client_for(owner).post("/api/v1/desk-reminders/", {"due_at": due_at}, format="json")
    assert response.status_code == 400


def test_create_logs_audit(owner):
    reminder = _create_reminder(owner=owner)
    assert DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id, action="CREATED").exists()


# --- Listado -------------------------------------------------------------------------


def test_owner_lists_own_reminders(owner, stranger):
    _create_reminder(owner=owner)
    _create_reminder(owner=stranger)
    response = _client_for(owner).get("/api/v1/desk-reminders/")
    assert response.status_code == 200
    assert len(response.data) == 1


def test_archived_excluded_by_default(owner):
    reminder = _create_reminder(owner=owner)
    _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "archive"}, format="json")
    response = _client_for(owner).get("/api/v1/desk-reminders/")
    assert response.data == []


def test_archived_appears_with_explicit_filter(owner):
    reminder = _create_reminder(owner=owner)
    _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "archive"}, format="json")
    response = _client_for(owner).get("/api/v1/desk-reminders/?archived=true")
    assert len(response.data) == 1


def test_filter_by_status(owner):
    reminder = _create_reminder(owner=owner)
    _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "complete"}, format="json")
    response = _client_for(owner).get("/api/v1/desk-reminders/?status=COMPLETADO")
    assert len(response.data) == 1
    assert response.data[0]["status"] == "COMPLETADO"


# --- Completar -------------------------------------------------------------------------


def test_complete_una_vez_does_not_create_next_occurrence(owner):
    reminder = _create_reminder(owner=owner, repeat="UNA_VEZ")
    response = _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "complete"}, format="json")
    assert response.status_code == 200
    assert response.data["status"] == "COMPLETADO"
    assert PersonalReminder.objects.filter(user=owner).count() == 1


def test_complete_repeating_creates_next_occurrence(owner):
    due_at = timezone.now() + timedelta(days=1)
    reminder = _create_reminder(owner=owner, repeat="DIARIO", due_at=due_at.isoformat())

    _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "complete"}, format="json")

    assert PersonalReminder.objects.filter(user=owner).count() == 2
    next_reminder = PersonalReminder.objects.filter(user=owner).exclude(id=reminder.id).get()
    assert next_reminder.status == "PENDIENTE"
    assert next_reminder.due_at.date() == (due_at + timedelta(days=1)).date()
    assert DeskAuditLog.objects.filter(
        entity_type="REMINDER", entity_id=next_reminder.id, action="CREATED", metadata__nextOccurrenceOf=reminder.id
    ).exists()


# --- Posponer / reabrir -----------------------------------------------------------------


def test_postpone_moves_due_at_and_resets_notified(owner):
    reminder = _create_reminder(owner=owner)
    reminder.notified = True
    reminder.save(update_fields=["notified"])
    new_due_at = timezone.now() + timedelta(days=5)

    response = _client_for(owner).patch(
        f"/api/v1/desk-reminders/{reminder.id}/", {"action": "postpone", "due_at": new_due_at.isoformat()}, format="json"
    )

    assert response.status_code == 200
    reminder.refresh_from_db()
    assert reminder.notified is False
    assert reminder.status == "PENDIENTE"
    assert DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id, action="POSTPONED").exists()


def test_reopen_requires_completed_status(owner):
    reminder = _create_reminder(owner=owner)
    response = _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "reopen"}, format="json")
    assert response.status_code == 409


def test_reopen_reuses_same_row_and_keeps_original_due_at(owner):
    reminder = _create_reminder(owner=owner)
    original_due_at = reminder.due_at
    _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "complete"}, format="json")

    response = _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "reopen"}, format="json")

    assert response.status_code == 200
    reminder.refresh_from_db()
    assert reminder.status == "PENDIENTE"
    assert reminder.due_at == original_due_at
    assert PersonalReminder.objects.filter(user=owner).count() == 1


def test_reopen_with_new_due_at_logs_postponed_too(owner):
    reminder = _create_reminder(owner=owner)
    _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "complete"}, format="json")
    new_due_at = timezone.now() + timedelta(days=3)

    _client_for(owner).patch(
        f"/api/v1/desk-reminders/{reminder.id}/", {"action": "reopen", "due_at": new_due_at.isoformat()}, format="json"
    )

    assert DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id, action="REOPENED").exists()
    assert DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id, action="POSTPONED").exists()


# --- Archivar / desarchivar --------------------------------------------------------------


def test_archive_and_unarchive(owner):
    reminder = _create_reminder(owner=owner)
    client = _client_for(owner)

    archived = client.patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "archive"}, format="json")
    assert archived.data["archived"] is True

    unarchived = client.patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "unarchive"}, format="json")
    assert unarchived.data["archived"] is False


# --- Edición directa -----------------------------------------------------------------------


def test_direct_edit_changes_title(owner):
    reminder = _create_reminder(owner=owner)
    response = _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"title": "Nuevo título"}, format="json")
    assert response.status_code == 200
    assert response.data["title"] == "Nuevo título"
    assert DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id, action="EDITED").exists()


def test_direct_edit_priority_change_logs_priority_changed(owner):
    reminder = _create_reminder(owner=owner)
    response = _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"priority": "URGENTE"}, format="json")
    assert response.status_code == 200
    assert DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id, action="PRIORITY_CHANGED").exists()
    assert not DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id, action="EDITED").exists()


def test_direct_edit_with_no_fields_does_not_log_audit(owner):
    reminder = _create_reminder(owner=owner)
    initial_count = DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id).count()
    response = _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {}, format="json")
    assert response.status_code == 200
    assert DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id).count() == initial_count


# --- Eliminación -----------------------------------------------------------------------


def test_owner_deletes_reminder(owner):
    reminder = _create_reminder(owner=owner)
    response = _client_for(owner).delete(f"/api/v1/desk-reminders/{reminder.id}/")
    assert response.status_code == 200
    assert not PersonalReminder.objects.filter(id=reminder.id).exists()
    assert DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id, action="DELETED").exists()


# --- Permisos (404, no 403, para recordatorios de otro usuario) ------------------------------


def test_stranger_gets_404_not_403_on_detail_actions(owner, stranger):
    reminder = _create_reminder(owner=owner)
    response = _client_for(stranger).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "pin"}, format="json")
    assert response.status_code == 404


def test_stranger_gets_404_deleting(owner, stranger):
    reminder = _create_reminder(owner=owner)
    response = _client_for(stranger).delete(f"/api/v1/desk-reminders/{reminder.id}/")
    assert response.status_code == 404
    assert PersonalReminder.objects.filter(id=reminder.id).exists()


# --- Historial -------------------------------------------------------------------------


def test_history_lists_audit_events(owner):
    reminder = _create_reminder(owner=owner)
    _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "archive"}, format="json")

    response = _client_for(owner).get(f"/api/v1/desk-reminders/{reminder.id}/history/")

    assert response.status_code == 200
    actions = [e["action"] for e in response.data]
    assert actions == ["CREATED", "ARCHIVED"]


# --- notify_due_reminders (barrido perezoso) ---------------------------------------------


def test_listing_notifies_due_reminders_once(owner):
    past_due = timezone.now() - timedelta(hours=1)
    reminder = _create_reminder(owner=owner, due_at=past_due.isoformat())

    _client_for(owner).get("/api/v1/desk-reminders/")
    reminder.refresh_from_db()
    assert reminder.notified is True
    assert Notification.objects.filter(user=owner).count() == 1

    _client_for(owner).get("/api/v1/desk-reminders/")
    assert Notification.objects.filter(user=owner).count() == 1
