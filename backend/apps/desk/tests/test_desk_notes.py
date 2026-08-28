"""Cobertura HTTP de `/api/v1/desk-notes/` — Fase 7a (ver
docs/AUDIT_LOG.md § 2026-08-17): CRUD core de Notas de Escritorio
Digital, sin Recordatorios/adjuntos/Papelera todavía, y SIN cutover de
`route.ts` (esta ruta no tiene consumidor real en Next.js en esta
sub-fase)."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.desk.models import DeskAuditLog, DeskNote, DeskNoteReply
from apps.notifications.models import Notification
from apps.users.models import User

pytestmark = pytest.mark.django_db


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


@pytest.fixture
def admin():
    user = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    return user


def _create_note(*, sender: User, recipient: User, **overrides) -> DeskNote:
    payload = {"recipient": recipient.id, "message": "Recordá enviar el informe hoy"}
    payload.update(overrides)
    response = _client_for(sender).post("/api/v1/desk-notes/", payload, format="json")
    assert response.status_code == 201, response.data
    return DeskNote.objects.get(id=response.data["id"])


# --- Creación ------------------------------------------------------------------------


def test_sender_creates_note_for_recipient(sender, recipient):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/", {"recipient": recipient.id, "message": "Hola, revisá esto"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["message"] == "Hola, revisá esto"
    assert response.data["sender"]["id"] == sender.id
    assert response.data["recipient"]["id"] == recipient.id
    assert response.data["is_mine"] is True
    assert response.data["priority"] == "INFORMACION"
    assert response.data["color"] == "AMARILLO"


def test_admin_cannot_create_notes(admin, recipient):
    response = _client_for(admin).post(
        "/api/v1/desk-notes/", {"recipient": recipient.id, "message": "Hola"}, format="json"
    )
    assert response.status_code == 403


def test_cannot_send_note_to_self(sender):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/", {"recipient": sender.id, "message": "Nota para mí mismo"}, format="json"
    )
    assert response.status_code == 400


def test_cannot_send_note_to_admin(sender, admin):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/", {"recipient": admin.id, "message": "Hola admin"}, format="json"
    )
    assert response.status_code == 400


def test_message_over_max_length_returns_400(sender, recipient):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/", {"recipient": recipient.id, "message": "a" * 501}, format="json"
    )
    assert response.status_code == 400


def test_create_notifies_recipient_and_logs_audit(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    assert Notification.objects.filter(user=recipient).exists()
    assert DeskAuditLog.objects.filter(entity_type="NOTE", entity_id=note.id, action="CREATED").exists()


# --- Listado -------------------------------------------------------------------------


def test_recipient_sees_note_in_desk_view(sender, recipient):
    _create_note(sender=sender, recipient=recipient)
    response = _client_for(recipient).get("/api/v1/desk-notes/")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["is_mine"] is False


def test_sender_sees_note_in_sent_view(sender, recipient):
    _create_note(sender=sender, recipient=recipient)
    response = _client_for(sender).get("/api/v1/desk-notes/?view=sent")
    assert len(response.data) == 1
    assert response.data[0]["is_mine"] is True


def test_archived_note_excluded_from_desk_view(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _client_for(recipient).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "archive"}, format="json")
    response = _client_for(recipient).get("/api/v1/desk-notes/")
    assert response.data == []


def test_archived_note_appears_in_archive_view(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _client_for(recipient).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "archive"}, format="json")
    response = _client_for(recipient).get("/api/v1/desk-notes/?view=archive")
    assert len(response.data) == 1


def test_admin_gets_403_listing_notes(admin):
    response = _client_for(admin).get("/api/v1/desk-notes/")
    assert response.status_code == 403


# --- Detalle -------------------------------------------------------------------------


def test_participants_can_view_detail(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    assert _client_for(sender).get(f"/api/v1/desk-notes/{note.id}/").status_code == 200
    assert _client_for(recipient).get(f"/api/v1/desk-notes/{note.id}/").status_code == 200


def test_stranger_cannot_view_detail(sender, recipient):
    stranger = User.objects.create_user(username="carla", email="carla@example.com", password="Sup3r-Secr3t!")
    stranger.groups.set([Group.objects.get(name="TRABAJO_SOCIAL")])
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(stranger).get(f"/api/v1/desk-notes/{note.id}/")
    assert response.status_code == 403


# --- Acciones (PATCH) -----------------------------------------------------------------


def test_recipient_marks_note_as_read_and_notifies_sender(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    Notification.objects.all().delete()

    response = _client_for(recipient).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "read"}, format="json")

    assert response.status_code == 200
    assert response.data["read"] is True
    note.refresh_from_db()
    assert note.read_at is not None
    assert Notification.objects.filter(user=sender).exists()
    assert DeskAuditLog.objects.filter(entity_type="NOTE", entity_id=note.id, action="READ").exists()


def test_marking_already_read_note_is_idempotent(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _client_for(recipient).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "read"}, format="json")
    note.refresh_from_db()
    first_read_at = note.read_at

    _client_for(recipient).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "read"}, format="json")
    note.refresh_from_db()

    assert note.read_at == first_read_at
    assert DeskAuditLog.objects.filter(entity_type="NOTE", entity_id=note.id, action="READ").count() == 1


def test_sender_cannot_patch_note(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(sender).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "pin"}, format="json")
    assert response.status_code == 403


def test_pin_and_unpin(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    client = _client_for(recipient)

    pinned = client.patch(f"/api/v1/desk-notes/{note.id}/", {"action": "pin"}, format="json")
    assert pinned.data["pinned"] is True

    unpinned = client.patch(f"/api/v1/desk-notes/{note.id}/", {"action": "unpin"}, format="json")
    assert unpinned.data["pinned"] is False


def test_archive_and_unarchive(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    client = _client_for(recipient)

    archived = client.patch(f"/api/v1/desk-notes/{note.id}/", {"action": "archive"}, format="json")
    assert archived.data["archived"] is True
    note.refresh_from_db()
    assert note.archived_at is not None

    unarchived = client.patch(f"/api/v1/desk-notes/{note.id}/", {"action": "unarchive"}, format="json")
    assert unarchived.data["archived"] is False
    note.refresh_from_db()
    assert note.archived_at is None


def test_invalid_action_returns_400(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(recipient).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "nope"}, format="json")
    assert response.status_code == 400


# --- Recipients / unread-count --------------------------------------------------------


def test_recipients_excludes_self_and_admins(sender, recipient, admin):
    response = _client_for(sender).get("/api/v1/desk-notes/recipients/")
    assert response.status_code == 200
    ids = [u["id"] for u in response.data]
    assert recipient.id in ids
    assert sender.id not in ids
    assert admin.id not in ids


def test_unread_count(sender, recipient):
    _create_note(sender=sender, recipient=recipient)
    _create_note(sender=sender, recipient=recipient)
    response = _client_for(recipient).get("/api/v1/desk-notes/unread-count/")
    assert response.data == {"unread": 2}


def test_unread_count_zero_for_admin(admin):
    response = _client_for(admin).get("/api/v1/desk-notes/unread-count/")
    assert response.status_code == 200
    assert response.data == {"unread": 0}


# --- Respuestas cortas -----------------------------------------------------------------


def test_participants_can_reply(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(recipient).post(
        f"/api/v1/desk-notes/{note.id}/replies/", {"message": "Gracias, ya lo reviso"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["author"]["id"] == recipient.id
    assert DeskAuditLog.objects.filter(entity_type="NOTE", entity_id=note.id, action="REPLIED").exists()


def test_stranger_cannot_reply(sender, recipient):
    stranger = User.objects.create_user(username="dario", email="dario@example.com", password="Sup3r-Secr3t!")
    stranger.groups.set([Group.objects.get(name="TRABAJO_SOCIAL")])
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(stranger).post(f"/api/v1/desk-notes/{note.id}/replies/", {"message": "Hola"}, format="json")
    assert response.status_code == 403


def test_reply_limit_returns_409(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    client_recipient = _client_for(recipient)
    client_sender = _client_for(sender)

    client_recipient.post(f"/api/v1/desk-notes/{note.id}/replies/", {"message": "Primera respuesta"}, format="json")
    client_sender.post(f"/api/v1/desk-notes/{note.id}/replies/", {"message": "Segunda respuesta"}, format="json")

    response = client_recipient.post(f"/api/v1/desk-notes/{note.id}/replies/", {"message": "Tercera"}, format="json")
    assert response.status_code == 409
    assert DeskNoteReply.objects.filter(note=note).count() == 2


def test_list_replies_ordered_ascending(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _client_for(recipient).post(f"/api/v1/desk-notes/{note.id}/replies/", {"message": "Uno"}, format="json")
    response = _client_for(sender).get(f"/api/v1/desk-notes/{note.id}/replies/")
    assert response.status_code == 200
    assert [r["message"] for r in response.data] == ["Uno"]


# --- Historial -------------------------------------------------------------------------


def test_history_lists_audit_events_for_participants(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _client_for(recipient).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "pin"}, format="json")

    response = _client_for(sender).get(f"/api/v1/desk-notes/{note.id}/history/")

    assert response.status_code == 200
    actions = [e["action"] for e in response.data]
    assert actions == ["CREATED", "PINNED"]


def test_history_forbidden_for_non_participant(sender, recipient):
    stranger = User.objects.create_user(username="elena", email="elena@example.com", password="Sup3r-Secr3t!")
    stranger.groups.set([Group.objects.get(name="TRABAJO_SOCIAL")])
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(stranger).get(f"/api/v1/desk-notes/{note.id}/history/")
    assert response.status_code == 403
