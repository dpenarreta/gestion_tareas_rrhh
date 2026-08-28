"""Importa `DeskNote` desde PostgreSQL (Next.js legacy) — Wave 3 de la
migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase 80).
Depende de `User` + `PersonalReminder` (Wave 2, FK opcional
`converted_to_reminder`). `DeskNoteReply` (Wave 4) depende de este
comando por `noteId`.

El `DeskNote` de Prisma no tiene `updatedAt` (solo `createdAt`), pero el
de Django hereda `BaseModel` — sin un `updatedAt` legacy real, se usa el
mismo valor que `created_at`. A diferencia de `ImprovementIdea`, el
`DeskNote` de Prisma SÍ tiene `attachmentMime` como columna propia — se
copia directo, sin `parse_data_url_mime`."""

from datetime import timezone as dt_timezone

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.core.legacy_migration import (
    bulk_import_rows,
    fetch_legacy_rows,
    filter_not_yet_imported,
    legacy_postgres_connection,
    resolve_legacy_ids,
)
from apps.desk.models import DeskNote, PersonalReminder
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa notas del Escritorio Digital desde DeskNote de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "senderId", "recipientId", message, priority, color, read, "readAt", '
                'pinned, archived, "archivedAt", "attachmentName", "attachmentMime", '
                '"attachmentData", "convertedToReminderId", "convertedAt", "deletedAt", "createdAt" '
                'FROM "DeskNote" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(DeskNote, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        reminder_ids = resolve_legacy_ids(
            PersonalReminder, [row["convertedToReminderId"] for row in pending_rows if row["convertedToReminderId"]]
        )
        user_legacy_ids = set()
        for row in pending_rows:
            user_legacy_ids.add(row["senderId"])
            user_legacy_ids.add(row["recipientId"])
        user_ids = resolve_legacy_ids(User, user_legacy_ids)

        instances = []
        failed = []
        for row in pending_rows:
            sender_id = user_ids.get(row["senderId"])
            recipient_id = user_ids.get(row["recipientId"])
            if sender_id is None or recipient_id is None:
                failed.append(f"{row['id']}: senderId/recipientId no resuelto en Django")
                continue
            created_at = _aware(row["createdAt"])
            instances.append(
                DeskNote(
                    legacy_postgres_id=row["id"],
                    sender_id=sender_id,
                    recipient_id=recipient_id,
                    message=row["message"],
                    priority=row["priority"],
                    color=row["color"],
                    read=row["read"],
                    read_at=_aware(row["readAt"]),
                    pinned=row["pinned"],
                    archived=row["archived"],
                    archived_at=_aware(row["archivedAt"]),
                    attachment_name=row["attachmentName"],
                    attachment_mime=row["attachmentMime"],
                    attachment_data=row["attachmentData"],
                    converted_to_reminder_id=(
                        reminder_ids.get(row["convertedToReminderId"]) if row["convertedToReminderId"] else None
                    ),
                    converted_at=_aware(row["convertedAt"]),
                    deleted_at=_aware(row["deletedAt"]),
                    created_at=created_at,
                    updated_at=created_at,
                )
            )

        created = bulk_import_rows(DeskNote, instances, batch_size=100)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
