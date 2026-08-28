"""Importa `ProjectParticipant` desde PostgreSQL (Next.js legacy) — Wave
2 de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende de `Project` (Wave 1) + `User`.

El Prisma original solo tiene `addedAt` (sin `createdAt`/`updatedAt`
propios), pero el Django hereda `BaseModel` (ganando `created_at`/
`updated_at` como plus) Y tiene su propio `added_at`
(`auto_now_add=True`, campo separado — ver `apps/projects/models.py`).
Los 3 campos automáticos se corrigen al mismo valor legacy de
`addedAt` — se pasa `auto_now_fields` explícito con los 3 nombres."""

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
from apps.projects.models import Project, ProjectParticipant
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa participantes de proyectos desde ProjectParticipant de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "projectId", "userId", "addedById", "addedAt" '
                'FROM "ProjectParticipant" ORDER BY "addedAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(ProjectParticipant, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        project_ids = resolve_legacy_ids(Project, [row["projectId"] for row in pending_rows])
        user_legacy_ids = set()
        for row in pending_rows:
            user_legacy_ids.add(row["userId"])
            user_legacy_ids.add(row["addedById"])
        user_ids = resolve_legacy_ids(User, user_legacy_ids)

        instances = []
        failed = []
        for row in pending_rows:
            project_id = project_ids.get(row["projectId"])
            user_id = user_ids.get(row["userId"])
            added_by_id = user_ids.get(row["addedById"])
            if project_id is None or user_id is None or added_by_id is None:
                failed.append(f"{row['id']}: projectId/userId/addedById no resuelto en Django")
                continue
            added_at = _aware(row["addedAt"])
            instances.append(
                ProjectParticipant(
                    legacy_postgres_id=row["id"],
                    project_id=project_id,
                    user_id=user_id,
                    added_by_id=added_by_id,
                    added_at=added_at,
                    created_at=added_at,
                    updated_at=added_at,
                )
            )

        created = bulk_import_rows(
            ProjectParticipant, instances, batch_size=200, auto_now_fields=("created_at", "updated_at", "added_at")
        )

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
