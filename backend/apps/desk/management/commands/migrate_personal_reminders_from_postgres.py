"""Importa `PersonalReminder` desde PostgreSQL (Next.js legacy) — Wave 2
de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende de `Task` (Wave 1, `converted_to_task` es FK real con
`SET_NULL` — a diferencia de las auditorías sueltas de Trabajo) +
`User`. `DeskNoteReply` (Wave 4) no depende de este comando, pero
`DeskNote.converted_to_reminder` (Wave 3) sí lo referencia."""

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
from apps.desk.models import PersonalReminder
from apps.tasks.models import Task
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa recordatorios personales desde PersonalReminder de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "userId", title, description, "dueAt", priority, status, repeat, '
                '"completedAt", archived, "archivedAt", notified, "attachmentName", '
                '"attachmentMime", "attachmentData", "convertedToTaskId", "convertedToTaskAt", '
                '"createdAt", "updatedAt" FROM "PersonalReminder" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(PersonalReminder, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        task_ids = resolve_legacy_ids(Task, [row["convertedToTaskId"] for row in pending_rows if row["convertedToTaskId"]])
        user_ids = resolve_legacy_ids(User, [row["userId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            user_id = user_ids.get(row["userId"])
            if user_id is None:
                failed.append(f"{row['id']}: userId no resuelto en Django")
                continue
            instances.append(
                PersonalReminder(
                    legacy_postgres_id=row["id"],
                    user_id=user_id,
                    title=row["title"],
                    description=row["description"],
                    due_at=_aware(row["dueAt"]),
                    priority=row["priority"],
                    status=row["status"],
                    repeat=row["repeat"],
                    completed_at=_aware(row["completedAt"]),
                    archived=row["archived"],
                    archived_at=_aware(row["archivedAt"]),
                    notified=row["notified"],
                    attachment_name=row["attachmentName"],
                    attachment_mime=row["attachmentMime"],
                    attachment_data=row["attachmentData"],
                    converted_to_task_id=task_ids.get(row["convertedToTaskId"]) if row["convertedToTaskId"] else None,
                    converted_to_task_at=_aware(row["convertedToTaskAt"]),
                    created_at=_aware(row["createdAt"]),
                    updated_at=_aware(row["updatedAt"]),
                )
            )

        created = bulk_import_rows(PersonalReminder, instances, batch_size=100)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
