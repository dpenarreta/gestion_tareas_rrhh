"""Importa `MonthClosure` desde PostgreSQL (Next.js legacy) — Wave 1 de
la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase
80). Depende solo de `User`.

`MonthClosure` no hereda `BaseModel`: su único campo de timestamp
automático es `closed_at` (`auto_now_add=True`, réplica del `closedAt`
legacy) — se pasa explícitamente `auto_now_fields=("closed_at",)` a
`bulk_import_rows` para que la corrección de timestamps (ver
`apps.core.legacy_migration`) apunte al campo correcto, no a
`created_at`/`updated_at` (que este modelo no tiene)."""

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
from apps.tasks.models import MonthClosure
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa cierres de mes desde MonthClosure de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, month, year, "closedBy", "closedAt", "cutoffDate", "closureType", '
                '"calendarDaysTotal", "calendarDaysConsidered", "workingDaysConsidered", '
                '"workingHoursConsidered", "totalTasks", "completedTasks", summary, corrections '
                'FROM "MonthClosure" ORDER BY year, month',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(MonthClosure, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_ids = resolve_legacy_ids(User, [row["closedBy"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            closed_by_id = user_ids.get(row["closedBy"])
            if closed_by_id is None:
                failed.append(f"{row['id']}: usuario closedBy no resuelto en Django")
                continue
            instances.append(
                MonthClosure(
                    legacy_postgres_id=row["id"],
                    month=row["month"],
                    year=row["year"],
                    closed_by_id=closed_by_id,
                    closed_at=_aware(row["closedAt"]),
                    cutoff_date=_aware(row["cutoffDate"]),
                    closure_type=row["closureType"],
                    calendar_days_total=row["calendarDaysTotal"],
                    calendar_days_considered=row["calendarDaysConsidered"],
                    working_days_considered=row["workingDaysConsidered"],
                    working_hours_considered=row["workingHoursConsidered"],
                    total_tasks=row["totalTasks"],
                    completed_tasks=row["completedTasks"],
                    summary=row["summary"],
                    corrections=row["corrections"],
                )
            )

        created = bulk_import_rows(MonthClosure, instances, auto_now_fields=("closed_at",))

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
