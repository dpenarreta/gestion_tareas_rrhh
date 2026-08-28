"""Importa `Comment` desde PostgreSQL (Next.js legacy) — Wave 2 de la
migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase 80).
Depende de `Task` (Wave 1) + `User`.

El `Comment` de Prisma no tiene `updatedAt` (solo `createdAt`), pero el
de Django hereda `BaseModel` — sin un `updatedAt` legacy real, se usa el
mismo valor que `created_at`."""

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
from apps.tasks.models import Comment, Task
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa comentarios de tareas desde Comment de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, text, "authorId", "taskId", "createdAt" FROM "Comment" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(Comment, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        task_ids = resolve_legacy_ids(Task, [row["taskId"] for row in pending_rows])
        user_ids = resolve_legacy_ids(User, [row["authorId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            task_id = task_ids.get(row["taskId"])
            author_id = user_ids.get(row["authorId"])
            if task_id is None or author_id is None:
                failed.append(f"{row['id']}: taskId/authorId no resuelto en Django")
                continue
            created_at = _aware(row["createdAt"])
            instances.append(
                Comment(
                    legacy_postgres_id=row["id"],
                    task_id=task_id,
                    author_id=author_id,
                    text=row["text"],
                    created_at=created_at,
                    updated_at=created_at,
                )
            )

        created = bulk_import_rows(Comment, instances, batch_size=200)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
