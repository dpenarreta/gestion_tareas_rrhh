"""Cobertura HTTP de `DELETE /api/v1/desk-notes/<id>/` y del barrido
perezoso de retención de archivo — Fase 14 (ver docs/AUDIT_LOG.md §
2026-08-20), réplica de `src/app/api/desk-notes/[id]/route.ts` (solo
`moveToTrash`, sin restaurar/listar/eliminar-definitivo por rutas
propias — asimetría deliberada frente a Proyectos) y de
`src/lib/deskNoteRetention.ts` (`purgeExpiredArchivedNotes`, mecanismo
independiente del Centro de Recuperación)."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.desk.models import DeskAuditAction, DeskAuditLog, DeskNote
from apps.recovery.models import RecoveryItem
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
def stranger():
    user = User.objects.create_user(username="carla", email="carla@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    return user


def _create_note(*, sender: User, recipient: User, **overrides) -> DeskNote:
    payload = {"recipient": recipient.id, "message": "Recordá enviar el informe hoy"}
    payload.update(overrides)
    response = _client_for(sender).post("/api/v1/desk-notes/", payload, format="json")
    assert response.status_code == 201, response.data
    return DeskNote.objects.get(id=response.data["id"])


def _archive(note: DeskNote, recipient: User) -> None:
    response = _client_for(recipient).patch(f"/api/v1/desk-notes/{note.id}/", {"action": "archive"}, format="json")
    assert response.status_code == 200, response.data


# --- DELETE /desk-notes/<id>/ ---------------------------------------------------------


def test_destroy_404_for_missing_note(sender):
    response = _client_for(sender).delete("/api/v1/desk-notes/999999/")
    assert response.status_code == 404


def test_sender_trashes_note(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(sender).delete(f"/api/v1/desk-notes/{note.id}/")
    assert response.status_code == 200
    assert response.data == {"success": True}

    note.refresh_from_db()
    assert note.deleted_at is not None
    assert RecoveryItem.objects.filter(entity_type="DESK_NOTE", entity_id=str(note.id)).exists()
    audit = DeskAuditLog.objects.get(entity_type="NOTE", entity_id=note.id, action=DeskAuditAction.DELETED)
    assert audit.metadata == {"origin": "manual", "actor": "sender"}


def test_sender_trashing_twice_returns_409(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _client_for(sender).delete(f"/api/v1/desk-notes/{note.id}/")
    # El primer DELETE ya soft-deletea la nota (deleted_at set) — el
    # get_queryset del ViewSet la excluye, así que un segundo intento
    # ve 404 (no 409) porque la nota ya no aparece en el queryset
    # base. Esto replica fielmente que el `route.ts` original también
    # filtra `deletedAt: null` antes de llegar a moveToTrash.
    response = _client_for(sender).delete(f"/api/v1/desk-notes/{note.id}/")
    assert response.status_code == 404


def test_recipient_cannot_delete_unarchived_note(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(recipient).delete(f"/api/v1/desk-notes/{note.id}/")
    assert response.status_code == 409
    assert response.data["error"] == "Solo puedes eliminar definitivamente una nota ya archivada"


def test_recipient_hard_deletes_archived_note(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _archive(note, recipient)

    response = _client_for(recipient).delete(f"/api/v1/desk-notes/{note.id}/")
    assert response.status_code == 200
    assert response.data == {"success": True}

    assert not DeskNote.objects.filter(pk=note.id).exists()
    assert not RecoveryItem.objects.filter(entity_type="DESK_NOTE", entity_id=str(note.id)).exists()
    audit = DeskAuditLog.objects.get(entity_type="NOTE", entity_id=note.id, action=DeskAuditAction.DELETED)
    assert audit.metadata == {"origin": "manual", "actor": "recipient"}


def test_stranger_cannot_delete_note(sender, recipient, stranger):
    note = _create_note(sender=sender, recipient=recipient)
    response = _client_for(stranger).delete(f"/api/v1/desk-notes/{note.id}/")
    assert response.status_code == 403


# --- purge_expired_archived_notes (barrido perezoso vía list()) ------------------------


def test_list_purges_expired_archived_notes(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _archive(note, recipient)
    note.archived_at = timezone.now() - timedelta(days=16)
    note.save(update_fields=["archived_at"])

    response = _client_for(recipient).get("/api/v1/desk-notes/", {"view": "archive"})
    assert response.status_code == 200
    assert response.data == []
    assert not DeskNote.objects.filter(pk=note.id).exists()
    audit = DeskAuditLog.objects.get(entity_type="NOTE", entity_id=note.id, action=DeskAuditAction.DELETED)
    assert audit.metadata == {"origin": "automatic", "reason": "archive_retention_expired"}


def test_list_keeps_recently_archived_notes(sender, recipient):
    note = _create_note(sender=sender, recipient=recipient)
    _archive(note, recipient)
    note.archived_at = timezone.now() - timedelta(days=1)
    note.save(update_fields=["archived_at"])

    response = _client_for(recipient).get("/api/v1/desk-notes/", {"view": "archive"})
    assert response.status_code == 200
    assert len(response.data) == 1
    assert DeskNote.objects.filter(pk=note.id).exists()


def test_list_does_not_purge_trashed_notes(sender, recipient):
    """`purge_expired_archived_notes` excluye `deleted_at__isnull=True`
    — una nota ya trasladada al Centro de Recuperación no debe volver
    a pasar por este segundo mecanismo, aunque coincidiera con el
    umbral de archivo."""
    note = _create_note(sender=sender, recipient=recipient)
    _archive(note, recipient)
    note.archived_at = timezone.now() - timedelta(days=16)
    note.deleted_at = timezone.now()
    note.save(update_fields=["archived_at", "deleted_at"])

    response = _client_for(sender).get("/api/v1/desk-notes/", {"view": "sent"})
    assert response.status_code == 200
    assert DeskNote.objects.filter(pk=note.id).exists()
