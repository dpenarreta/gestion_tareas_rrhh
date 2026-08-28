"""Cobertura HTTP de adjuntos de `/api/v1/desk-notes/` — Fase 7d (ver
docs/AUDIT_LOG.md § 2026-08-17): réplica de `saveAttachment`
(`src/lib/storage.ts`) + `GET /desk-notes/[id]/attachment`."""

import base64

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.desk.models import DeskNote
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


@pytest.fixture
def note_with_attachment(sender, recipient):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/",
        {
            "recipient": recipient.id,
            "message": "Te paso el archivo",
            "attachment_name": "captura.png",
            "attachment_mime": "image/png",
            "attachment_data": TINY_PNG_DATA_URL,
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    return DeskNote.objects.get(id=response.data["id"])


# --- Creación con adjunto --------------------------------------------------------------


def test_creates_note_with_attachment(sender, recipient):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/",
        {
            "recipient": recipient.id,
            "message": "Con adjunto",
            "attachment_name": "captura.png",
            "attachment_mime": "image/png",
            "attachment_data": TINY_PNG_DATA_URL,
        },
        format="json",
    )
    assert response.status_code == 201
    assert response.data["has_attachment"] is True
    assert response.data["attachment_name"] == "captura.png"
    assert response.data["attachment_mime"] == "image/png"


def test_creates_note_without_attachment_defaults_to_no_attachment(sender, recipient):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/", {"recipient": recipient.id, "message": "Sin adjunto"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["has_attachment"] is False
    assert response.data["attachment_name"] is None


def test_rejects_disallowed_extension(sender, recipient):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/",
        {
            "recipient": recipient.id,
            "message": "Con adjunto malo",
            "attachment_name": "script.exe",
            "attachment_data": "data:application/octet-stream;base64,QQ==",
        },
        format="json",
    )
    assert response.status_code == 400


def test_rejects_attachment_over_max_size(sender, recipient):
    oversized = base64.b64encode(b"0" * (8 * 1024 * 1024 + 1)).decode()
    response = _client_for(sender).post(
        "/api/v1/desk-notes/",
        {
            "recipient": recipient.id,
            "message": "Con adjunto gigante",
            "attachment_name": "grande.pdf",
            "attachment_data": f"data:application/pdf;base64,{oversized}",
        },
        format="json",
    )
    assert response.status_code == 400


def test_requires_attachment_name_when_data_present(sender, recipient):
    response = _client_for(sender).post(
        "/api/v1/desk-notes/",
        {"recipient": recipient.id, "message": "Sin nombre", "attachment_data": TINY_PNG_DATA_URL},
        format="json",
    )
    assert response.status_code == 400


# --- Descarga ---------------------------------------------------------------------------


def test_sender_downloads_attachment(sender, note_with_attachment):
    response = _client_for(sender).get(f"/api/v1/desk-notes/{note_with_attachment.id}/attachment/")
    assert response.status_code == 200
    assert response["Content-Type"] == "image/png"
    assert 'filename="captura.png"' in response["Content-Disposition"]
    assert response.content == TINY_PNG_BYTES


def test_recipient_downloads_attachment(recipient, note_with_attachment):
    response = _client_for(recipient).get(f"/api/v1/desk-notes/{note_with_attachment.id}/attachment/")
    assert response.status_code == 200
    assert response.content == TINY_PNG_BYTES


def test_stranger_gets_404_before_403_when_no_attachment(sender, recipient):
    plain = _client_for(sender).post(
        "/api/v1/desk-notes/", {"recipient": recipient.id, "message": "Sin adjunto"}, format="json"
    )
    note_id = plain.data["id"]
    stranger = User.objects.create_user(username="carla", email="carla@example.com", password="Sup3r-Secr3t!")
    stranger.groups.set([Group.objects.get(name="TRABAJO_SOCIAL")])

    response = _client_for(stranger).get(f"/api/v1/desk-notes/{note_id}/attachment/")
    assert response.status_code == 404


def test_stranger_gets_403_when_attachment_exists(note_with_attachment):
    stranger = User.objects.create_user(username="dario", email="dario@example.com", password="Sup3r-Secr3t!")
    stranger.groups.set([Group.objects.get(name="TRABAJO_SOCIAL")])

    response = _client_for(stranger).get(f"/api/v1/desk-notes/{note_with_attachment.id}/attachment/")
    assert response.status_code == 403


def test_returns_404_for_nonexistent_note(sender):
    response = _client_for(sender).get("/api/v1/desk-notes/999999/attachment/")
    assert response.status_code == 404
