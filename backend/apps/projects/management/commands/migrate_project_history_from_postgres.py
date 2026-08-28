"""Importa `ProjectHistory` desde PostgreSQL (Next.js legacy) — Wave 2
de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende de `Project` (Wave 1) + `User`."""

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
from apps.projects.models import Project, ProjectHistory
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa el historial de auditoría de proyectos desde ProjectHistory de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "projectId", "actorId", event, description, "previousValue", '
                '"newValue", "createdAt" FROM "ProjectHistory" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(ProjectHistory, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        project_ids = resolve_legacy_ids(Project, [row["projectId"] for row in pending_rows])
        user_ids = resolve_legacy_ids(User, [row["actorId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            project_id = project_ids.get(row["projectId"])
            actor_id = user_ids.get(row["actorId"])
            if project_id is None or actor_id is None:
                failed.append(f"{row['id']}: projectId/actorId no resuelto en Django")
                continue
            instances.append(
                ProjectHistory(
                    legacy_postgres_id=row["id"],
                    project_id=project_id,
                    actor_id=actor_id,
                    event=row["event"],
                    description=row["description"],
                    previous_value=row["previousValue"],
                    new_value=row["newValue"],
                    created_at=_aware(row["createdAt"]),
                )
            )

        created = bulk_import_rows(ProjectHistory, instances, batch_size=200)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
