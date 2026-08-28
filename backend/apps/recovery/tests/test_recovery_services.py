"""Cobertura de apps.recovery.services — Fase 14 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de src/lib/recoveryCenter.ts."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from apps.desk.models import DeskNote
from apps.projects.models import Project
from apps.recovery.models import (
    RecoveryAuditLog,
    RecoveryItem,
    RecoveryOperation,
    RecoveryOrigin,
    RecoveryStatus,
)
from apps.recovery.services import (
    RecoveryError,
    delete_permanently,
    get_remaining_retention_time,
    list_active_trash,
    move_to_trash,
    purge_expired_items,
    restore,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 20, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def user():
    return User.objects.create_user(username="u", email="u@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def other_user():
    return User.objects.create_user(username="u2", email="u2@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def project(user):
    return Project.objects.create(
        name="Proyecto", priority="MEDIA", start_date=NOW, target_date=NOW + timedelta(days=30),
        target_time_hours=10, responsible=user, created_by=user,
    )


@pytest.fixture
def desk_note(user, other_user):
    return DeskNote.objects.create(sender=user, recipient=other_user, message="Hola")


# --- move_to_trash ------------------------------------------------------------------


def test_move_to_trash_unregistered_entity_type_raises(user):
    with pytest.raises(RecoveryError, match="no registrada"):
        move_to_trash(entity_type="TASK", entity_id="1", user=user)


def test_move_to_trash_creates_item_and_sets_local_flag(user, project):
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)

    assert item.status == RecoveryStatus.ACTIVE
    assert item.entity_label == "Proyecto"
    assert item.module_label == "Proyectos"
    assert item.deleted_by == user
    assert item.retention_hours == 48
    assert item.expires_at == item.deleted_at + timedelta(hours=48)

    project.refresh_from_db()
    assert project.deleted_at is not None

    assert RecoveryAuditLog.objects.filter(
        entity_type="PROJECT", entity_id=str(project.id), operation=RecoveryOperation.MOVE_TO_TRASH, origin=RecoveryOrigin.MANUAL
    ).exists()


def test_move_to_trash_truncates_long_desk_note_label(user, other_user):
    note = DeskNote.objects.create(sender=user, recipient=other_user, message="x" * 100)
    item = move_to_trash(entity_type="DESK_NOTE", entity_id=str(note.id), user=user)
    assert item.entity_label == f"{'x' * 60}…"
    assert item.module_label == "Escritorio Digital"


def test_move_to_trash_already_active_raises(user, project):
    move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    with pytest.raises(RecoveryError, match="ya está en la papelera"):
        move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)


# --- restore -------------------------------------------------------------------------


def test_restore_not_in_trash_raises(user, project):
    with pytest.raises(RecoveryError, match="no está en la papelera"):
        restore(entity_type="PROJECT", entity_id=str(project.id), user=user)


def test_restore_expired_raises(user, project):
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    item.expires_at = item.deleted_at - timedelta(hours=1)
    item.save(update_fields=["expires_at"])

    with pytest.raises(RecoveryError, match="ya expiró"):
        restore(entity_type="PROJECT", entity_id=str(project.id), user=user)


def test_restore_clears_local_flag_and_marks_restored(user, project):
    move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    item = restore(entity_type="PROJECT", entity_id=str(project.id), user=user)

    assert item.status == RecoveryStatus.RESTORED
    assert item.restored_by == user
    assert item.restored_at is not None

    project.refresh_from_db()
    assert project.deleted_at is None

    assert RecoveryAuditLog.objects.filter(entity_type="PROJECT", operation=RecoveryOperation.RESTORE).exists()


# --- delete_permanently ---------------------------------------------------------------


def test_delete_permanently_not_in_trash_raises(user, project):
    with pytest.raises(RecoveryError, match="no está en la papelera"):
        delete_permanently(entity_type="PROJECT", entity_id=str(project.id), user=user)


def test_delete_permanently_hard_deletes_and_marks_purged(user, project):
    project_id = project.id
    move_to_trash(entity_type="PROJECT", entity_id=str(project_id), user=user)
    delete_permanently(entity_type="PROJECT", entity_id=str(project_id), user=user)

    assert not Project.objects.filter(pk=project_id).exists()
    item = RecoveryItem.objects.get(entity_type="PROJECT", entity_id=str(project_id))
    assert item.status == RecoveryStatus.PURGED
    assert item.purge_origin == RecoveryOrigin.MANUAL
    assert item.purged_by == user
    assert RecoveryAuditLog.objects.filter(entity_type="PROJECT", operation=RecoveryOperation.DELETE_PERMANENTLY).exists()


# --- purge_expired_items ---------------------------------------------------------------


def test_purge_expired_items_ignores_non_expired(user, project):
    move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    result = purge_expired_items()
    assert result == {"purged": 0}
    assert Project.objects.filter(pk=project.id).exists()


def test_purge_expired_items_hard_deletes_expired_and_audits_with_no_user(user, project):
    project_id = project.id
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project_id), user=user)
    item.expires_at = item.deleted_at - timedelta(hours=1)
    item.save(update_fields=["expires_at"])

    result = purge_expired_items()

    assert result == {"purged": 1}
    assert not Project.objects.filter(pk=project_id).exists()
    item.refresh_from_db()
    assert item.status == RecoveryStatus.PURGED
    assert item.purge_origin == RecoveryOrigin.AUTOMATIC
    audit = RecoveryAuditLog.objects.get(entity_type="PROJECT", operation=RecoveryOperation.PURGE_EXPIRED)
    assert audit.user is None
    assert audit.origin == RecoveryOrigin.AUTOMATIC


def test_purge_expired_items_sweeps_across_entity_types(user, other_user, project, desk_note):
    """Réplica fiel del acoplamiento incidental del TS: purgar no
    filtra por `entity_type` — abrir la papelera de un módulo purga
    los vencidos de TODOS los módulos registrados."""
    project_item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    project_item.expires_at = project_item.deleted_at - timedelta(hours=1)
    project_item.save(update_fields=["expires_at"])

    note_item = move_to_trash(entity_type="DESK_NOTE", entity_id=str(desk_note.id), user=user)
    note_item.expires_at = note_item.deleted_at - timedelta(hours=1)
    note_item.save(update_fields=["expires_at"])

    result = purge_expired_items()
    assert result == {"purged": 2}


def test_purge_expired_items_skips_unregistered_entity_type_without_error():
    RecoveryItem.objects.create(
        entity_type="LEGACY_MODULE", entity_id="999", module_label="Retirado",
        deleted_by=User.objects.create_user(username="ghost", email="ghost@example.com", password="Sup3r-Secr3t!"),
        deleted_at=NOW, retention_hours=1, expires_at=NOW - timedelta(hours=1),
    )
    result = purge_expired_items()
    assert result == {"purged": 0}
    assert RecoveryItem.objects.get(entity_type="LEGACY_MODULE").status == RecoveryStatus.ACTIVE


# --- get_remaining_retention_time / list_active_trash -----------------------------------


def test_get_remaining_retention_time_none_when_not_trashed(project):
    assert get_remaining_retention_time("PROJECT", str(project.id)) is None


def test_get_remaining_retention_time_reflects_expires_at(user, project):
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    result = get_remaining_retention_time("PROJECT", str(project.id))
    assert result["expires_at"] == item.expires_at
    assert result["ms_remaining"] > 0


def test_list_active_trash_scoped_to_entity_type(user, project, desk_note):
    move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    move_to_trash(entity_type="DESK_NOTE", entity_id=str(desk_note.id), user=user)

    project_trash = list(list_active_trash("PROJECT"))
    assert len(project_trash) == 1
    assert project_trash[0].entity_id == str(project.id)
