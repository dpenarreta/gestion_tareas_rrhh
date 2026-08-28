"""Cobertura HTTP de `POST /api/v1/desk-notes/[id]/convert-to-reminder/`
— Fase 7e (ver docs/AUDIT_LOG.md § 2026-08-17): réplica de
`src/app/api/desk-notes/[id]/convert-to-reminder/route.ts`."""

import base64
from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.desk.models import DeskAuditLog, DeskNote, PersonalReminder
from apps.users.models import User

pytestmark = pytest.mark.django_db

TINY_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
TINY_PNG_DATA_URL = f"data:image/png;base64,{base64.b64encode(TINY_PNG_BYTES).decode()}"


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def sender():
    user = User.objects.create_user(username="ana", email="ana@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def recipient():
    user = User.objects.create_user(username="bruno", email="bruno@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


def _create_note(*, sender: User, recipient: User, **overrides) -> DeskNote:
    payload = {"recipient": recipient.id, "message": "Recordá enviar el informe hoy"}
    payload.update(overrides)
    response = _client_for(sender).post("/api/v1/desk-notes/", payload, format="json")
    assert response.status_code == 201, response.data
    return DeskNote.objects.get(id=response.data["id"])


def _convert(client, note, **overrides):
    body = {"due_at": (timezone.now() + timedelta(days=1)).isoformat()}
    body.update(overrides)
    return client.post(f"/api/v1/desk-notes/{note.id}/convert-to-reminder/", body, format="json")


def test_requires_authentication(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _convert(APIClient(), note)
    assert response.status_code == 401


def test_returns_404_when_note_does_not_exist(recipient):
    fake = DeskNote(id=999999)
    response = _convert(_client_for(recipient), fake)
    assert response.status_code == 404


def test_returns_403_when_not_the_recipient(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _convert(_client_for(sender), note)
    assert response.status_code == 403


def test_returns_409_when_already_converted(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    first = _convert(_client_for(recipient), note)
    assert first.status_code == 201

    second = _convert(_client_for(recipient), note)
    assert second.status_code == 409


def test_returns_400_when_missing_due_at(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(recipient).post(f"/api/v1/desk-notes/{note.id}/convert-to-reminder/", {}, format="json")
    assert response.status_code == 400


def test_creates_reminder_and_marks_note_without_deleting_it(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient, priority="IMPORTANTE")

    response = _convert(_client_for(recipient), note)
    assert response.status_code == 201

    reminder = PersonalReminder.objects.get(id=response.data["reminder_id"])
    assert reminder.title == "Recordá enviar el informe hoy"
    assert reminder.description == "Recordá enviar el informe hoy"
    assert reminder.priority == "ALTA"
    assert reminder.user_id == recipient.id

    note.refresh_from_db()
    assert note.converted_to_reminder_id == reminder.id
    assert note.converted_at is not None
    assert DeskNote.objects.filter(id=note.id).exists()

    assert DeskAuditLog.objects.filter(
        entity_type="NOTE", entity_id=note.id, action="CONVERTED_TO_REMINDER", metadata__reminderId=reminder.id
    ).exists()
    assert DeskAuditLog.objects.filter(
        entity_type="REMINDER", entity_id=reminder.id, action="CREATED", metadata__convertedFromNoteId=note.id
    ).exists()


def test_priority_maps_from_note_when_not_provided(sender, recipient):
    cases = {"INFORMACION": "BAJA", "RECORDATORIO": "MEDIA", "IMPORTANTE": "ALTA", "URGENTE": "URGENTE"}
    for note_priority, expected in cases.items():
        note = _create_note(sender=sender, recipient=recipient, priority=note_priority)
        response = _convert(_client_for(recipient), note)
        reminder = PersonalReminder.objects.get(id=response.data["reminder_id"])
        assert reminder.priority == expected


def test_custom_priority_overrides_mapped_priority(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient, priority="INFORMACION")
    response = _convert(_client_for(recipient), note, priority="URGENTE")
    reminder = PersonalReminder.objects.get(id=response.data["reminder_id"])
    assert reminder.priority == "URGENTE"


def test_custom_title_overrides_note_message(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _convert(_client_for(recipient), note, title="Otro título")
    assert response.data["reminder_title"] == "Otro título"


def test_long_message_truncated_with_ellipsis_when_title_omitted(sender, recipient):
    # A diferencia del TS (que trunca a 150 y agrega "…", quedando en
    # 151 caracteres — cabe en el String sin límite de Postgres), acá
    # se trunca a 149 para que el resultado con "…" quepa en el
    # CharField(max_length=150) de Django (ver docstring del service).
    long_message = "a" * 200
    note = _create_note(sender=sender, recipient=recipient, message=long_message)
    response = _convert(_client_for(recipient), note)
    assert response.data["reminder_title"] == f"{'a' * 149}…"
    assert len(response.data["reminder_title"]) == 150


def test_attachment_is_copied_from_note(sender, recipient):
    note = _create_note(
        sender=sender,
        recipient=recipient,
        attachment_name="captura.png",
        attachment_mime="image/png",
        attachment_data=TINY_PNG_DATA_URL,
    )
    response = _convert(_client_for(recipient), note)
    reminder = PersonalReminder.objects.get(id=response.data["reminder_id"])
    assert reminder.attachment_name == "captura.png"
    assert reminder.attachment_mime == "image/png"
    assert reminder.attachment_data == TINY_PNG_DATA_URL


def test_reminder_serializer_exposes_has_attachment_without_data(sender, recipient):
    note = _create_note(
        sender=sender,
        recipient=recipient,
        attachment_name="captura.png",
        attachment_mime="image/png",
        attachment_data=TINY_PNG_DATA_URL,
    )
    convert_response = _convert(_client_for(recipient), note)
    reminder_id = convert_response.data["reminder_id"]

    response = _client_for(recipient).get("/api/v1/desk-reminders/")
    reminder_data = next(r for r in response.data if r["id"] == reminder_id)
    assert reminder_data["has_attachment"] is True
    assert reminder_data["attachment_name"] == "captura.png"
    assert "attachment_data" not in reminder_data
