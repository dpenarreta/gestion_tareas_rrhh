"""Lógica de negocio de Escritorio Digital — Fases 7a-7e (ver
docs/AUDIT_LOG.md § 2026-08-17). Réplica campo por campo de
`src/app/api/desk-notes/**`/`src/app/api/desk-reminders/**`."""

import calendar
import logging
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers as drf_serializers
from rest_framework.exceptions import PermissionDenied

from apps.notifications.services import notify
from apps.tasks.models import Task
from apps.tasks.services import TaskService

from .models import DeskAuditAction, DeskAuditLog, DeskNote, DeskNoteReply, PersonalReminder
from .permissions import role_name

logger = logging.getLogger("apps.desk")

# Fase 7a §PATCH — acciones válidas sobre una nota, exclusivas del
# destinatario. Réplica de `ACTIONS`/`ACTION_AUDIT` en
# `desk-notes/[id]/route.ts`.
NOTE_ACTIONS = ("read", "pin", "unpin", "archive", "unarchive")
ACTION_AUDIT: dict[str, str] = {
    "read": DeskAuditAction.READ,
    "pin": DeskAuditAction.PINNED,
    "unpin": DeskAuditAction.UNPINNED,
    "archive": DeskAuditAction.ARCHIVED,
    "unarchive": DeskAuditAction.UNARCHIVED,
}


def log_desk_audit(*, entity_type: str, entity_id: int, user, action: str, metadata: dict | None = None) -> None:
    """Nunca lanza — la auditoría no debe poder tumbar la acción que
    audita, réplica de `logDeskAudit` (`src/lib/deskAudit.ts`)."""
    try:
        DeskAuditLog.objects.create(
            entity_type=entity_type, entity_id=entity_id, user=user, action=action, metadata=metadata
        )
    except Exception:  # noqa: BLE001
        logger.exception("[desk] no se pudo registrar el evento de auditoría")


def purge_expired_archived_notes() -> dict:
    """Retención propia del archivo del destinatario — Fase 14 (ver
    docs/AUDIT_LOG.md § 2026-08-20). Barrido perezoso (mismo criterio
    que `apps.recovery.services.purge_expired_items` y
    `notify_due_reminders`) — se dispara al listar notas, no por un
    cron dedicado. Intencionalmente INDEPENDIENTE del Centro de
    Recuperación: es la retención del archivo, no la papelera del
    remitente (no crea/lee `RecoveryItem`). Réplica exacta de
    `purgeExpiredArchivedNotes`."""
    from apps.configuration.services import get_effective_desk_archive_retention_days

    retention_days = get_effective_desk_archive_retention_days(timezone.now())
    cutoff = timezone.now() - timedelta(days=retention_days)
    expired = list(
        DeskNote.objects.filter(archived=True, archived_at__lte=cutoff, deleted_at__isnull=True).select_related("recipient")
    )

    for note in expired:
        note_id, recipient = note.id, note.recipient
        note.delete()
        log_desk_audit(
            entity_type="NOTE", entity_id=note_id, user=recipient, action=DeskAuditAction.DELETED,
            metadata={"origin": "automatic", "reason": "archive_retention_expired"},
        )

    return {"purged": len(expired)}


class DeskNoteService:
    @staticmethod
    def create_note(
        *,
        actor,
        recipient,
        message: str,
        priority: str,
        color: str,
        attachment_name: str | None = None,
        attachment_mime: str | None = None,
        attachment_data: str | None = None,
    ) -> DeskNote:
        """Réplica de `POST /desk-notes` — el serializer ya validó
        extensión/tamaño del adjunto (Fase 7d), acá solo se persiste."""
        if recipient.id == actor.id:
            raise drf_serializers.ValidationError({"recipient": ["No puedes dejarte una nota a ti mismo"]})
        if role_name(recipient) == "ADMINISTRADOR":
            raise drf_serializers.ValidationError({"recipient": ["Destinatario inválido"]})

        note = DeskNote.objects.create(
            sender=actor,
            recipient=recipient,
            message=message,
            priority=priority,
            color=color,
            attachment_name=attachment_name,
            attachment_mime=attachment_mime,
            attachment_data=attachment_data,
        )

        notify(user=recipient, message=f"{actor.first_name or actor.username} dejó una nota en tu Escritorio Digital")
        log_desk_audit(entity_type="NOTE", entity_id=note.id, user=actor, action=DeskAuditAction.CREATED)
        return note

    @staticmethod
    def apply_action(*, actor, note: DeskNote, action: str) -> DeskNote:
        """Réplica de `PATCH /desk-notes/[id]` — exclusivo del
        destinatario (ya verificado por `IsDeskNoteRecipient`)."""
        if action not in NOTE_ACTIONS:
            raise drf_serializers.ValidationError({"action": ["Acción inválida"]})

        # Idempotente: marcar leída una nota ya leída no reescribe
        # `read_at` ni genera auditoría/notificación duplicada.
        if action == "read" and note.read:
            return note

        now = timezone.now()
        if action == "read":
            note.read = True
            note.read_at = now
            note.save(update_fields=["read", "read_at", "updated_at"])
        elif action == "pin":
            note.pinned = True
            note.save(update_fields=["pinned", "updated_at"])
        elif action == "unpin":
            note.pinned = False
            note.save(update_fields=["pinned", "updated_at"])
        elif action == "archive":
            note.archived = True
            note.archived_at = now
            note.save(update_fields=["archived", "archived_at", "updated_at"])
        else:  # unarchive
            note.archived = False
            note.archived_at = None
            note.save(update_fields=["archived", "archived_at", "updated_at"])

        log_desk_audit(entity_type="NOTE", entity_id=note.id, user=actor, action=ACTION_AUDIT[action])

        # Confirmación de lectura para el remitente, solo en la Campana.
        if action == "read":
            notify(user=note.sender, message=f"{actor.first_name or actor.username} leyó tu Nota Rápida.")

        return note

    @staticmethod
    def trash_note(*, actor, note: DeskNote) -> None:
        """Nota enviada a la papelera por su remitente — reversible
        (aunque, como confirma la investigación de esta fase, sin
        ninguna ruta de restauración real todavía: mismo gap real del
        TS, que solo implementó `moveToTrash` para `DESK_NOTE`, nunca
        `restore`/`listActiveTrash`/`deletePermanently`). Réplica
        exacta de la rama `senderId === session.userId` de `DELETE
        /desk-notes/[id]` — Fase 14 (ver docs/AUDIT_LOG.md §
        2026-08-20). Propaga `RecoveryError` tal cual (la vista la
        traduce a 409)."""
        from apps.recovery.services import move_to_trash

        move_to_trash(entity_type="DESK_NOTE", entity_id=str(note.id), user=actor)
        log_desk_audit(
            entity_type="NOTE", entity_id=note.id, user=actor, action=DeskAuditAction.DELETED,
            metadata={"origin": "manual", "actor": "sender"},
        )

    @staticmethod
    def delete_archived_note_permanently(*, actor, note: DeskNote) -> None:
        """Borrado definitivo por el destinatario de una nota YA
        archivada — misma vía que usa `purge_expired_archived_notes`.
        Réplica exacta de la rama `recipientId === session.userId` de
        `DELETE /desk-notes/[id]` — Fase 14 (ver docs/AUDIT_LOG.md §
        2026-08-20). El caller valida `note.archived` antes de llamar
        (la vista replica el 409 exacto del TS)."""
        note_id = note.id
        note.delete()
        log_desk_audit(
            entity_type="NOTE", entity_id=note_id, user=actor, action=DeskAuditAction.DELETED,
            metadata={"origin": "manual", "actor": "recipient"},
        )

    # ── Fase 7e (ver docs/AUDIT_LOG.md § 2026-08-17) — convert-to-reminder ─

    # Escala de la nota (4 niveles) mapea 1:1 a la escala de recordatorios
    # (4 niveles) — réplica de `PRIORITY_MAP` en el `route.ts` original.
    NOTE_TO_REMINDER_PRIORITY = {
        DeskNote.Priority.INFORMACION: PersonalReminder.Priority.BAJA,
        DeskNote.Priority.RECORDATORIO: PersonalReminder.Priority.MEDIA,
        DeskNote.Priority.IMPORTANTE: PersonalReminder.Priority.ALTA,
        DeskNote.Priority.URGENTE: PersonalReminder.Priority.URGENTE,
    }

    MAX_TITLE_LENGTH = 150

    @staticmethod
    def convert_to_reminder(*, actor, note: DeskNote, title: str, due_at, priority: str | None) -> PersonalReminder:
        """Réplica de `POST /desk-notes/[id]/convert-to-reminder` —
        completamente opcional. La nota original permanece intacta y
        visible, solo queda marcada `converted_to_reminder`/
        `converted_at`. El adjunto (si existe) se COPIA al recordatorio
        en vez de referenciarse, para que sobreviva aunque la nota se
        archive y se purgue automáticamente a los 15 días.

        Gap aceptado: el TS trunca a `MAX_TITLE_LENGTH` (150) caracteres
        y AGREGA "…", quedando en 151 — cabe en el `String` sin límite
        de Postgres, pero no en `PersonalReminder.title` de Django
        (`CharField(max_length=150)`, real en MSSQL). Acá se trunca a
        149 para que el resultado con "…" quede en 150."""
        if not title:
            title = (
                f"{note.message[: DeskNoteService.MAX_TITLE_LENGTH - 1]}…"
                if len(note.message) > DeskNoteService.MAX_TITLE_LENGTH
                else note.message
            )
        if not priority:
            priority = DeskNoteService.NOTE_TO_REMINDER_PRIORITY[note.priority]

        reminder = PersonalReminder.objects.create(
            user=actor,
            title=title,
            description=note.message,
            due_at=due_at,
            priority=priority,
            attachment_name=note.attachment_name,
            attachment_mime=note.attachment_mime,
            attachment_data=note.attachment_data,
        )

        note.converted_to_reminder = reminder
        note.converted_at = timezone.now()
        note.save(update_fields=["converted_to_reminder", "converted_at", "updated_at"])

        log_desk_audit(
            entity_type="NOTE", entity_id=note.id, user=actor,
            action=DeskAuditAction.CONVERTED_TO_REMINDER, metadata={"reminderId": reminder.id},
        )
        log_desk_audit(
            entity_type="REMINDER", entity_id=reminder.id, user=actor,
            action=DeskAuditAction.CREATED, metadata={"convertedFromNoteId": note.id},
        )
        return reminder


class DeskNoteReplyService:
    @staticmethod
    def other_party(*, actor, note: DeskNote):
        """Réplica de `otherPartyId` — el otro participante de la nota,
        o `None`/excepción si `actor` no es ninguno de los dos (usado
        también por la vista para el chequeo de límite de respuestas,
        que necesita saber cuántas van antes de decidir el 409)."""
        if actor.id == note.sender_id:
            return note.recipient
        if actor.id == note.recipient_id:
            return note.sender
        raise PermissionDenied("Sin permisos")

    @staticmethod
    def create_reply(*, actor, note: DeskNote, message: str, other_party) -> DeskNoteReply:
        """Réplica de `POST /desk-notes/[id]/replies` — el chequeo de
        límite de respuestas (409) ya lo resolvió la vista antes de
        llamar acá, mismo criterio que `ParticipantService.add_participant`
        en Proyectos (el 409 vive en la vista, no en el service)."""
        reply = DeskNoteReply.objects.create(note=note, author=actor, message=message)

        notify(user=other_party, message=f"{actor.first_name or actor.username} respondió tu Nota Rápida.")
        log_desk_audit(entity_type="NOTE", entity_id=note.id, user=actor, action=DeskAuditAction.REPLIED)
        return reply


# ── Fase 7b (ver docs/AUDIT_LOG.md § 2026-08-17) — Recordatorios ──────────────


def advance_repeat(due_at: datetime, repeat: str) -> datetime:
    """Réplica de `advanceRepeat` (`src/lib/deskReminders.ts`) — próxima
    ocurrencia de un recordatorio repetitivo, conserva hora/minuto.
    Para MENSUAL: a diferencia de `Date.setUTCMonth` en JS (que
    desborda al mes siguiente si el día no existe ahí, ej. 31 ene ->
    2/3 mar), acá se clampea al último día del mes destino (28/29 feb)
    — gap aceptado y documentado (ver docs/AUDIT_LOG.md § 2026-08-17,
    Fase 7b): edge case raro (vencimientos en día 29-31 con repetición
    mensual cruzando a un mes más corto), sin impacto funcional
    conocido, y evita sumar una dependencia nueva (`dateutil`) solo
    para replicar un desborde de fecha que el propio TS no parece
    haber probado tampoco."""
    if repeat == PersonalReminder.Repeat.DIARIO:
        return due_at + timedelta(days=1)
    if repeat == PersonalReminder.Repeat.SEMANAL:
        return due_at + timedelta(days=7)
    if repeat == PersonalReminder.Repeat.MENSUAL:
        year = due_at.year + (due_at.month // 12)
        month = due_at.month % 12 + 1
        last_day = calendar.monthrange(year, month)[1]
        return due_at.replace(year=year, month=month, day=min(due_at.day, last_day))
    return due_at  # UNA_VEZ


def notify_due_reminders(user) -> None:
    """Réplica de `notifyDueReminders` — barrido perezoso (se llama
    desde el `list` de la vista, nunca un cron): notifica UNA vez por
    vencimiento gracias a `notified`. No depende de `businessTime`
    (verificado contra el TS: el `businessTime` importado en
    `deskReminders.ts` solo lo usa `todayRange()`, que ningún flujo de
    esta sub-fase llama)."""
    now = timezone.now()
    due = list(PersonalReminder.objects.filter(user=user, status=PersonalReminder.Status.PENDIENTE, notified=False, due_at__lte=now))
    if not due:
        return
    with transaction.atomic():
        PersonalReminder.objects.filter(id__in=[r.id for r in due]).update(notified=True)
        for reminder in due:
            notify(user=user, message=f'Recordatorio: "{reminder.title}"')


class PersonalReminderService:
    @staticmethod
    def create_reminder(*, actor, title: str, description: str, due_at, priority: str, repeat: str) -> PersonalReminder:
        """Réplica de `POST /desk-reminders`."""
        reminder = PersonalReminder.objects.create(
            user=actor, title=title, description=description or None, due_at=due_at, priority=priority, repeat=repeat
        )
        log_desk_audit(entity_type="REMINDER", entity_id=reminder.id, user=actor, action=DeskAuditAction.CREATED)
        return reminder

    @staticmethod
    def complete(*, actor, reminder: PersonalReminder) -> PersonalReminder:
        """Réplica de la rama `action === "complete"` — si es
        repetitivo, genera automáticamente la siguiente ocurrencia."""
        original_repeat = reminder.repeat
        original_due_at = reminder.due_at
        reminder.status = PersonalReminder.Status.COMPLETADO
        reminder.completed_at = timezone.now()
        reminder.save(update_fields=["status", "completed_at", "updated_at"])
        log_desk_audit(entity_type="REMINDER", entity_id=reminder.id, user=actor, action=DeskAuditAction.COMPLETED)

        if original_repeat != PersonalReminder.Repeat.UNA_VEZ:
            next_reminder = PersonalReminder.objects.create(
                user=actor,
                title=reminder.title,
                description=reminder.description,
                due_at=advance_repeat(original_due_at, original_repeat),
                priority=reminder.priority,
                repeat=original_repeat,
            )
            log_desk_audit(
                entity_type="REMINDER",
                entity_id=next_reminder.id,
                user=actor,
                action=DeskAuditAction.CREATED,
                metadata={"nextOccurrenceOf": reminder.id},
            )
        return reminder

    @staticmethod
    def postpone(*, actor, reminder: PersonalReminder, due_at) -> PersonalReminder:
        """Réplica de la rama `action === "postpone"` — solo mueve
        `due_at`, mantiene pendiente y reabre la notificación."""
        previous_due_at = reminder.due_at
        reminder.due_at = due_at
        reminder.status = PersonalReminder.Status.PENDIENTE
        reminder.completed_at = None
        reminder.notified = False
        reminder.save(update_fields=["due_at", "status", "completed_at", "notified", "updated_at"])
        log_desk_audit(
            entity_type="REMINDER",
            entity_id=reminder.id,
            user=actor,
            action=DeskAuditAction.POSTPONED,
            metadata={"from": previous_due_at.isoformat(), "to": due_at.isoformat()},
        )
        return reminder

    @staticmethod
    def reopen(*, actor, reminder: PersonalReminder, due_at=None) -> PersonalReminder:
        """Réplica de la rama `action === "reopen"` — nunca crea fila
        nueva (mismo id, mismo historial). `due_at` es opcional: si no
        viene, conserva la fecha/hora original."""
        previous_due_at = reminder.due_at
        reminder.status = PersonalReminder.Status.PENDIENTE
        reminder.completed_at = None
        reminder.archived = False
        reminder.archived_at = None
        reminder.notified = False
        update_fields = ["status", "completed_at", "archived", "archived_at", "notified", "updated_at"]
        if due_at is not None:
            reminder.due_at = due_at
            update_fields.append("due_at")
        reminder.save(update_fields=update_fields)

        log_desk_audit(entity_type="REMINDER", entity_id=reminder.id, user=actor, action=DeskAuditAction.REOPENED)
        if due_at is not None:
            log_desk_audit(
                entity_type="REMINDER",
                entity_id=reminder.id,
                user=actor,
                action=DeskAuditAction.POSTPONED,
                metadata={"from": previous_due_at.isoformat(), "to": due_at.isoformat()},
            )
        return reminder

    @staticmethod
    def set_archived(*, actor, reminder: PersonalReminder, archived: bool) -> PersonalReminder:
        """Réplica de las ramas `action === "archive"/"unarchive"` —
        independiente del estado (la UI solo lo ofrece sobre
        completados, pero la API no lo exige, igual que el TS)."""
        reminder.archived = archived
        reminder.archived_at = timezone.now() if archived else None
        reminder.save(update_fields=["archived", "archived_at", "updated_at"])
        log_desk_audit(
            entity_type="REMINDER",
            entity_id=reminder.id,
            user=actor,
            action=DeskAuditAction.ARCHIVED if archived else DeskAuditAction.UNARCHIVED,
        )
        return reminder

    @staticmethod
    def edit(*, actor, reminder: PersonalReminder, fields: dict) -> PersonalReminder:
        """Réplica de la edición directa de campos (sin `action` en el
        body) — solo audita `PRIORITY_CHANGED` si cambió la prioridad,
        si no `EDITED`; sin campos → no audita, devuelve tal cual
        (réplica de `Object.keys(data).length === 0`)."""
        if not fields:
            return reminder

        priority_changed = "priority" in fields and fields["priority"] != reminder.priority
        previous_priority = reminder.priority

        for field, value in fields.items():
            setattr(reminder, field, value)
        if "due_at" in fields:
            reminder.notified = False
        reminder.save()

        log_desk_audit(
            entity_type="REMINDER",
            entity_id=reminder.id,
            user=actor,
            action=DeskAuditAction.PRIORITY_CHANGED if priority_changed else DeskAuditAction.EDITED,
            metadata={"from": previous_priority, "to": reminder.priority} if priority_changed else None,
        )
        return reminder

    # ── Fase 7c (ver docs/AUDIT_LOG.md § 2026-08-17) — convert-to-task ────

    # El recordatorio no tiene "prioridad de tarea" propia — se traduce a
    # la escala de Trabajo (ALTA/MEDIA/BAJA). URGENTE colapsa en ALTA a
    # propósito: Trabajo no tiene un cuarto nivel. Réplica de
    # `PRIORITY_MAP` en el `route.ts` original.
    REMINDER_TO_TASK_PRIORITY = {
        PersonalReminder.Priority.URGENTE: Task.Priority.ALTA,
        PersonalReminder.Priority.ALTA: Task.Priority.ALTA,
        PersonalReminder.Priority.MEDIA: Task.Priority.MEDIA,
        PersonalReminder.Priority.BAJA: Task.Priority.BAJA,
    }

    @staticmethod
    def convert_to_task(
        *, actor, reminder: PersonalReminder, title: str, type: str, frequency: str, start_date, end_date, estimated_hours: float
    ) -> Task:
        """Réplica de `POST /desk-reminders/[id]/convert-to-task` —
        completamente opcional, reutiliza `TaskService.create_task` sin
        modificar Trabajo. El recordatorio original nunca se edita ni se
        elimina — solo queda marcado `converted_to_task`/
        `converted_to_task_at`. Sin adjunto todavía: `PersonalReminder`
        no tiene adjuntos en Django (ver docstring de `models.py`), así
        que a diferencia del TS no hay nombre de archivo que referenciar
        en la descripción."""
        task = TaskService.create_task(
            actor=actor,
            title=title.strip() or reminder.title,
            description=reminder.description or "",
            type=type,
            status=Task.Status.PENDIENTE,
            priority=PersonalReminderService.REMINDER_TO_TASK_PRIORITY[reminder.priority],
            frequency=frequency,
            start_date=start_date,
            end_date=end_date,
            estimated_hours=estimated_hours,
            assigned_to=actor,
        )

        reminder.converted_to_task = task
        reminder.converted_to_task_at = timezone.now()
        reminder.save(update_fields=["converted_to_task", "converted_to_task_at", "updated_at"])

        log_desk_audit(
            entity_type="REMINDER",
            entity_id=reminder.id,
            user=actor,
            action=DeskAuditAction.CONVERTED_TO_TASK,
            metadata={"taskId": task.id},
        )
        return task
