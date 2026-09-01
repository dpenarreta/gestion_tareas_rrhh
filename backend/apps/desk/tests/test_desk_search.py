"""Cobertura HTTP de `GET /api/v1/desk/search/` — Fase 7f (ver
docs/AUDIT_LOG.md § 2026-08-17): réplica de
`src/app/api/desk/search/route.ts` (buscador único de Escritorio
Digital)."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.desk.models import DeskNote, PersonalReminder
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
def other():
    user = User.objects.create_user(username="bruno", email="bruno@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


@pytest.fixture
def admin():
    user = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    return user


def _send_note(*, sender: User, recipient: User, **overrides) -> dict:
    payload = {"recipient": recipient.id, "message": "Recordá enviar el informe hoy"}
    payload.update(overrides)
    response = _client_for(sender).post("/api/v1/desk-notes/", payload, format="json")
    assert response.status_code == 201, response.data
    return response.data


def test_requires_authentication():
    response = APIClient().get("/api/v1/desk/search/")
    assert response.status_code == 401


def test_admin_can_search(admin):
    # Ver docs/AUDIT_LOG.md § 2026-09-01 ("SuperUsuario = ADMINISTRADOR con
    # todo el catálogo explícito") — ADMINISTRADOR tiene
    # `escritorio_digital.usar` sembrado explícito desde la migración 0004.
    response = _client_for(admin).get("/api/v1/desk/search/")
    assert response.status_code == 200
    assert response.data["notes"] == []
    assert response.data["reminders"] == []


def test_empty_query_returns_all_notes_and_reminders_involving_user(owner, other):
    _send_note(sender=owner, recipient=other, message="Enviada")
    _send_note(sender=other, recipient=owner, message="Recibida")
    PersonalReminder.objects.create(user=owner, title="Mi recordatorio", due_at=timezone.now() + timedelta(days=1))

    response = _client_for(owner).get("/api/v1/desk/search/")
    assert response.status_code == 200
    assert len(response.data["notes"]) == 2
    assert len(response.data["reminders"]) == 1


def test_excludes_notes_where_user_is_not_a_participant(owner, other):
    third = User.objects.create_user(username="carla", email="carla@example.com", password="Sup3r-Secr3t!")
    third.groups.set([Group.objects.get(name="TRABAJO_SOCIAL")])
    _send_note(sender=other, recipient=third, message="No te incumbe")

    response = _client_for(owner).get("/api/v1/desk/search/")
    assert response.data["notes"] == []


def test_excludes_reminders_of_other_users(owner, other):
    PersonalReminder.objects.create(user=other, title="Ajeno", due_at=timezone.now() + timedelta(days=1))
    response = _client_for(owner).get("/api/v1/desk/search/")
    assert response.data["reminders"] == []


# --- Texto libre (q) -----------------------------------------------------------------------


def test_q_matches_note_message(owner, other):
    _send_note(sender=other, recipient=owner, message="Revisar el contrato de Finanzas")
    _send_note(sender=other, recipient=owner, message="Otra cosa totalmente distinta")

    response = _client_for(owner).get("/api/v1/desk/search/?q=contrato")
    assert len(response.data["notes"]) == 1


def test_q_matches_note_reply(owner, other):
    note = _send_note(sender=other, recipient=owner, message="Nota original")
    _client_for(owner).post(f"/api/v1/desk-notes/{note['id']}/replies/", {"message": "hablemos del presupuesto"}, format="json")

    response = _client_for(owner).get("/api/v1/desk/search/?q=presupuesto")
    assert len(response.data["notes"]) == 1


def test_q_matches_reminder_title_or_description(owner):
    PersonalReminder.objects.create(
        user=owner, title="Llamar a Finanzas", description="", due_at=timezone.now() + timedelta(days=1)
    )
    PersonalReminder.objects.create(
        user=owner, title="Otro", description="revisar el contrato de Finanzas", due_at=timezone.now() + timedelta(days=1)
    )
    PersonalReminder.objects.create(user=owner, title="Sin relación", due_at=timezone.now() + timedelta(days=1))

    response = _client_for(owner).get("/api/v1/desk/search/?q=finanzas")
    assert len(response.data["reminders"]) == 2


# --- Prioridad -------------------------------------------------------------------------


def test_filters_notes_by_priority(owner, other):
    _send_note(sender=other, recipient=owner, message="Urgente de verdad", priority="URGENTE")
    _send_note(sender=other, recipient=owner, message="Informativa", priority="INFORMACION")

    response = _client_for(owner).get("/api/v1/desk/search/?priority=URGENTE")
    assert len(response.data["notes"]) == 1
    assert response.data["notes"][0]["priority"] == "URGENTE"


def test_filters_reminders_by_priority(owner):
    PersonalReminder.objects.create(user=owner, title="Alta", priority="ALTA", due_at=timezone.now() + timedelta(days=1))
    PersonalReminder.objects.create(user=owner, title="Baja", priority="BAJA", due_at=timezone.now() + timedelta(days=1))

    response = _client_for(owner).get("/api/v1/desk/search/?priority=ALTA")
    assert len(response.data["reminders"]) == 1


def test_invalid_priority_is_ignored(owner, other):
    _send_note(sender=other, recipient=owner, message="Cualquiera")
    response = _client_for(owner).get("/api/v1/desk/search/?priority=NOPE")
    assert len(response.data["notes"]) == 1


# --- Fecha -----------------------------------------------------------------------------


def test_filters_notes_by_exact_date(owner, other):
    note_data = _send_note(sender=other, recipient=owner, message="De hoy")
    DeskNote.objects.filter(id=note_data["id"]).update(created_at=datetime(2026, 1, 5, 12, 0, tzinfo=dt_timezone.utc))

    matching = _client_for(owner).get("/api/v1/desk/search/?date=2026-01-05")
    assert len(matching.data["notes"]) == 1

    non_matching = _client_for(owner).get("/api/v1/desk/search/?date=2026-01-06")
    assert non_matching.data["notes"] == []


# --- Remitente / destinatario (solo notas) --------------------------------------------------


def test_filters_notes_by_sender_name(owner, other):
    _send_note(sender=other, recipient=owner, message="De bruno")
    response = _client_for(owner).get(f"/api/v1/desk/search/?sender={other.username}")
    assert len(response.data["notes"]) == 1


def test_filters_notes_by_recipient_name(owner, other):
    _send_note(sender=owner, recipient=other, message="Para bruno")
    response = _client_for(owner).get(f"/api/v1/desk/search/?recipient={other.username}")
    assert len(response.data["notes"]) == 1


# --- Estado ------------------------------------------------------------------------------


def test_status_pendiente_filters_unread_unarchived_notes(owner, other):
    read = _send_note(sender=other, recipient=owner, message="Leída")
    _client_for(owner).patch(f"/api/v1/desk-notes/{read['id']}/", {"action": "read"}, format="json")
    _send_note(sender=other, recipient=owner, message="Pendiente")

    response = _client_for(owner).get("/api/v1/desk/search/?status=PENDIENTE")
    assert len(response.data["notes"]) == 1
    assert response.data["notes"][0]["message"] == "Pendiente"


def test_status_archivada_filters_archived_notes(owner, other):
    note = _send_note(sender=other, recipient=owner, message="Archivada")
    _client_for(owner).patch(f"/api/v1/desk-notes/{note['id']}/", {"action": "archive"}, format="json")
    _send_note(sender=other, recipient=owner, message="No archivada")

    response = _client_for(owner).get("/api/v1/desk/search/?status=ARCHIVADA")
    assert len(response.data["notes"]) == 1


def test_status_completado_filters_completed_reminders(owner):
    reminder = PersonalReminder.objects.create(user=owner, title="Completo", due_at=timezone.now() + timedelta(days=1))
    _client_for(owner).patch(f"/api/v1/desk-reminders/{reminder.id}/", {"action": "complete"}, format="json")
    PersonalReminder.objects.create(user=owner, title="Pendiente", due_at=timezone.now() + timedelta(days=1))

    response = _client_for(owner).get("/api/v1/desk/search/?status=COMPLETADO")
    assert len(response.data["reminders"]) == 1
    assert response.data["reminders"][0]["title"] == "Completo"


# --- Forma de la respuesta ---------------------------------------------------------------


def test_note_result_shape(owner, other):
    _send_note(sender=other, recipient=owner, message="Con forma")
    response = _client_for(owner).get("/api/v1/desk/search/")
    note = response.data["notes"][0]
    assert set(note.keys()) == {
        "id", "message", "priority", "color", "read", "archived", "created_at",
        "sender_id", "sender_name", "recipient_id", "recipient_name", "is_mine", "reply_count",
    }
    assert note["is_mine"] is False
