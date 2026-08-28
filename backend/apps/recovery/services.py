"""Centro de Recuperación — Fase 14 (ver docs/AUDIT_LOG.md §
2026-08-20). Réplica exacta de `src/lib/recoveryCenter.ts`: único
mecanismo oficial de eliminación temporal/restauración de Nexo,
diseño abierto/cerrado (`ENTITY_REGISTRY`, dict de adaptadores —
agregar un módulo nuevo es agregar una entrada de datos, nunca tocar
la lógica de `move_to_trash`/`restore`/`delete_permanently`/
`purge_expired_items`). Solo 2 adaptadores implementados hoy (PROJECT,
DESK_NOTE), réplica fiel del alcance real del TS — Trabajo, Documentos,
Repositorios, Plantillas y Comunicados quedan como módulos compatibles,
no implementados todavía."""

from dataclasses import dataclass
from datetime import timedelta
from typing import Callable

from django.db import transaction
from django.utils import timezone

from apps.configuration.services import get_effective_recovery_retention_hours
from apps.core.rounding import round_half_up

from .models import (
    RecoveryAuditLog,
    RecoveryItem,
    RecoveryOperation,
    RecoveryOrigin,
    RecoveryStatus,
)


class RecoveryError(Exception):
    """Distingue los errores curados de este módulo (mensaje ya pensado
    para mostrarse al usuario) de cualquier excepción inesperada —
    réplica exacta de `RecoveryError`."""


@dataclass(frozen=True)
class EntityAdapter:
    module_label: str
    get_display_name: Callable[[str], str | None]
    set_trashed: Callable[[str, bool], None]
    hard_delete: Callable[[str], None]


def _project_get_display_name(entity_id: str) -> str | None:
    from apps.projects.models import Project

    project = Project.objects.filter(pk=entity_id).only("name").first()
    return project.name if project else None


def _project_set_trashed(entity_id: str, trashed: bool) -> None:
    from apps.projects.models import Project

    Project.objects.filter(pk=entity_id).update(deleted_at=timezone.now() if trashed else None)


def _project_hard_delete(entity_id: str) -> None:
    from apps.projects.models import Project

    Project.objects.filter(pk=entity_id).delete()


def _desk_note_get_display_name(entity_id: str) -> str | None:
    from apps.desk.models import DeskNote

    note = DeskNote.objects.filter(pk=entity_id).only("message").first()
    if note is None:
        return None
    return f"{note.message[:60]}…" if len(note.message) > 60 else note.message


def _desk_note_set_trashed(entity_id: str, trashed: bool) -> None:
    from apps.desk.models import DeskNote

    DeskNote.objects.filter(pk=entity_id).update(deleted_at=timezone.now() if trashed else None)


def _desk_note_hard_delete(entity_id: str) -> None:
    from apps.desk.models import DeskNote

    DeskNote.objects.filter(pk=entity_id).delete()


ENTITY_REGISTRY: dict[str, EntityAdapter] = {
    "PROJECT": EntityAdapter(
        module_label="Proyectos",
        get_display_name=_project_get_display_name,
        set_trashed=_project_set_trashed,
        hard_delete=_project_hard_delete,
    ),
    "DESK_NOTE": EntityAdapter(
        module_label="Escritorio Digital",
        get_display_name=_desk_note_get_display_name,
        set_trashed=_desk_note_set_trashed,
        hard_delete=_desk_note_hard_delete,
    ),
}


def _get_adapter(entity_type: str) -> EntityAdapter:
    adapter = ENTITY_REGISTRY.get(entity_type)
    if adapter is None:
        raise RecoveryError(f"Tipo de entidad no registrada en el Centro de Recuperación: {entity_type}")
    return adapter


def register_audit_event(
    *, entity_type: str, entity_id: str, module_label: str, user, operation: str, origin: str
) -> None:
    """Auditoría central — una fila por operación, para cualquier
    módulo. Réplica exacta de `registerAuditEvent`."""
    RecoveryAuditLog.objects.create(
        entity_type=entity_type, entity_id=entity_id, module_label=module_label, user=user, operation=operation, origin=origin
    )


def move_to_trash(*, entity_type: str, entity_id: str, user) -> RecoveryItem:
    """Réplica exacta de `moveToTrash`. Lanza `RecoveryError` si el
    tipo no está registrado o si ya está en la papelera."""
    adapter = _get_adapter(entity_type)

    existing_active = RecoveryItem.objects.filter(entity_type=entity_type, entity_id=entity_id, status=RecoveryStatus.ACTIVE).exists()
    if existing_active:
        raise RecoveryError("Este elemento ya está en la papelera")

    retention_hours = get_effective_recovery_retention_hours(timezone.now())
    deleted_at = timezone.now()
    expires_at = deleted_at + timedelta(hours=retention_hours)
    entity_label = adapter.get_display_name(entity_id)

    with transaction.atomic():
        item = RecoveryItem.objects.create(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label,
            module_label=adapter.module_label,
            status=RecoveryStatus.ACTIVE,
            deleted_by=user,
            deleted_at=deleted_at,
            retention_hours=retention_hours,
            expires_at=expires_at,
        )

        adapter.set_trashed(entity_id, True)
        register_audit_event(
            entity_type=entity_type, entity_id=entity_id, module_label=adapter.module_label, user=user,
            operation=RecoveryOperation.MOVE_TO_TRASH, origin=RecoveryOrigin.MANUAL,
        )

    return item


def restore(*, entity_type: str, entity_id: str, user) -> RecoveryItem:
    """Réplica exacta de `restore`. Lanza `RecoveryError` si no está en
    la papelera o si ya expiró."""
    adapter = _get_adapter(entity_type)

    item = (
        RecoveryItem.objects.filter(entity_type=entity_type, entity_id=entity_id, status=RecoveryStatus.ACTIVE)
        .order_by("-deleted_at")
        .first()
    )
    if item is None:
        raise RecoveryError("Este elemento no está en la papelera")
    if item.expires_at <= timezone.now():
        raise RecoveryError("El período de retención de este elemento ya expiró")

    with transaction.atomic():
        item.status = RecoveryStatus.RESTORED
        item.restored_at = timezone.now()
        item.restored_by = user
        item.save(update_fields=["status", "restored_at", "restored_by"])

        adapter.set_trashed(entity_id, False)
        register_audit_event(
            entity_type=entity_type, entity_id=entity_id, module_label=adapter.module_label, user=user,
            operation=RecoveryOperation.RESTORE, origin=RecoveryOrigin.MANUAL,
        )

    return item


def delete_permanently(*, entity_type: str, entity_id: str, user) -> None:
    """Elimina definitivamente una entidad en la papelera (acción
    manual, "Eliminar para siempre"). Réplica exacta de
    `deletePermanently`."""
    adapter = _get_adapter(entity_type)

    item = (
        RecoveryItem.objects.filter(entity_type=entity_type, entity_id=entity_id, status=RecoveryStatus.ACTIVE)
        .order_by("-deleted_at")
        .first()
    )
    if item is None:
        raise RecoveryError("Este elemento no está en la papelera")

    with transaction.atomic():
        adapter.hard_delete(entity_id)
        item.status = RecoveryStatus.PURGED
        item.purged_at = timezone.now()
        item.purged_by = user
        item.purge_origin = RecoveryOrigin.MANUAL
        item.save(update_fields=["status", "purged_at", "purged_by", "purge_origin"])

        register_audit_event(
            entity_type=entity_type, entity_id=entity_id, module_label=adapter.module_label, user=user,
            operation=RecoveryOperation.DELETE_PERMANENTLY, origin=RecoveryOrigin.MANUAL,
        )


def purge_expired_items() -> dict:
    """Purga automática de elementos cuyo período de retención expiró.
    Idempotente y sin script masivo dedicado — se invoca de forma
    perezosa cada vez que se abre una papelera (réplica exacta de
    `purgeExpiredItems`, incluyendo que NO filtra por `entity_type`:
    abrir la papelera de un módulo purga los elementos vencidos de
    TODOS los módulos registrados)."""
    expired = list(RecoveryItem.objects.filter(status=RecoveryStatus.ACTIVE, expires_at__lte=timezone.now()))

    purged = 0
    for item in expired:
        adapter = ENTITY_REGISTRY.get(item.entity_type)
        if adapter is None:
            # Tipo desregistrado (ej. módulo retirado) — se deja para
            # revisión manual, no se pierde el registro.
            continue

        try:
            adapter.hard_delete(item.entity_id)
        except Exception:  # noqa: BLE001 — la fila ya pudo eliminarse por otra vía, igual se marca purgada abajo.
            pass

        with transaction.atomic():
            item.status = RecoveryStatus.PURGED
            item.purged_at = timezone.now()
            item.purge_origin = RecoveryOrigin.AUTOMATIC
            item.save(update_fields=["status", "purged_at", "purge_origin"])

            register_audit_event(
                entity_type=item.entity_type, entity_id=item.entity_id, module_label=item.module_label, user=None,
                operation=RecoveryOperation.PURGE_EXPIRED, origin=RecoveryOrigin.AUTOMATIC,
            )

        purged += 1

    return {"purged": purged}


def get_remaining_retention_time(entity_type: str, entity_id: str) -> dict | None:
    """Réplica exacta de `getRemainingRetentionTime`."""
    item = (
        RecoveryItem.objects.filter(entity_type=entity_type, entity_id=entity_id, status=RecoveryStatus.ACTIVE)
        .order_by("-deleted_at")
        .first()
    )
    if item is None:
        return None
    remaining = (item.expires_at - timezone.now()).total_seconds() * 1000
    return {"expires_at": item.expires_at, "ms_remaining": max(0, round_half_up(remaining))}


def list_active_trash(entity_type: str):
    """Elementos actualmente en la papelera para un tipo de entidad —
    la autorización de quién puede verlos queda a cargo del módulo
    llamante. Réplica exacta de `listActiveTrash`."""
    return RecoveryItem.objects.filter(entity_type=entity_type, status=RecoveryStatus.ACTIVE).order_by("-deleted_at")
