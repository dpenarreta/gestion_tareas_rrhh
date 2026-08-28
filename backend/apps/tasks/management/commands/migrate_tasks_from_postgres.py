"""Importa `Task` desde PostgreSQL (Next.js legacy) — Wave 1 de la
migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase 80).
Depende solo de `User` (ya migrado vía `migrate_users_from_postgres`).

Solo LEE de Postgres (nunca escribe) y es idempotente vía
`filter_not_yet_imported` (ver `apps.core.legacy_migration`)."""

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
from apps.tasks.models import Task
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa Tareas desde Task de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, title, description, status, priority, frequency, type, '
                '"startDate", "endDate", "estimatedHours", "realHours", '
                '"targetTimeValidated", "targetTimeValidatedAt", "targetTimeValidatedById", '
                '"endDateApprovalStatus", "endDateApprovedAt", "endDateApprovedById", '
                'progress, "completedAt", "assignedToId", "createdById", color, '
                '"archivedMonth", "archivedAt", corrected, "createdAt", "updatedAt" '
                'FROM "Task" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(Task, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_legacy_ids = set()
        for row in pending_rows:
            user_legacy_ids.add(row["assignedToId"])
            user_legacy_ids.add(row["createdById"])
            if row["targetTimeValidatedById"]:
                user_legacy_ids.add(row["targetTimeValidatedById"])
            if row["endDateApprovedById"]:
                user_legacy_ids.add(row["endDateApprovedById"])
        user_ids = resolve_legacy_ids(User, user_legacy_ids)

        instances = []
        failed = []
        for row in pending_rows:
            assigned_to_id = user_ids.get(row["assignedToId"])
            created_by_id = user_ids.get(row["createdById"])
            if assigned_to_id is None or created_by_id is None:
                failed.append(f"{row['id']}: usuario assignedTo/createdBy no resuelto en Django")
                continue
            instances.append(
                Task(
                    legacy_postgres_id=row["id"],
                    title=row["title"],
                    description=row["description"] or "",
                    status=row["status"],
                    priority=row["priority"],
                    frequency=row["frequency"],
                    type=row["type"],
                    start_date=_aware(row["startDate"]),
                    end_date=_aware(row["endDate"]),
                    estimated_hours=row["estimatedHours"],
                    real_hours=row["realHours"],
                    target_time_validated=row["targetTimeValidated"],
                    target_time_validated_at=_aware(row["targetTimeValidatedAt"]),
                    target_time_validated_by_id=user_ids.get(row["targetTimeValidatedById"]),
                    end_date_approval_status=row["endDateApprovalStatus"],
                    end_date_approved_at=_aware(row["endDateApprovedAt"]),
                    end_date_approved_by_id=user_ids.get(row["endDateApprovedById"]),
                    progress=row["progress"],
                    completed_at=_aware(row["completedAt"]),
                    assigned_to_id=assigned_to_id,
                    created_by_id=created_by_id,
                    color=row["color"] or "",
                    archived_month=row["archivedMonth"],
                    archived_at=_aware(row["archivedAt"]),
                    corrected=row["corrected"],
                    created_at=_aware(row["createdAt"]),
                    updated_at=_aware(row["updatedAt"]),
                )
            )

        created = bulk_import_rows(Task, instances)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
