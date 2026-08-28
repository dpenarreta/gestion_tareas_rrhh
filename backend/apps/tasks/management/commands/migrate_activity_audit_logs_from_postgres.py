"""Importa `ActivityAuditLog` desde PostgreSQL (Next.js legacy) — Wave 3
de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende de `TaskActivity` (Wave 2, solo para resolver el id
numérico de Django — `activity_id` en sí queda como referencia SUELTA,
sin FK) + `User`.

`modified_at` NO es `auto_now_add` en este modelo (ver
`apps/tasks/models.py`) — sin corrección de timestamps que aplicar."""

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
from apps.tasks.models import ActivityAuditLog, TaskActivity
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa auditoría de ediciones de horas desde ActivityAuditLog de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "activityId", "adminId", "oldDuration", "newDuration", comment, "modifiedAt" '
                'FROM "ActivityAuditLog" ORDER BY "modifiedAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(ActivityAuditLog, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        activity_ids = resolve_legacy_ids(TaskActivity, [row["activityId"] for row in pending_rows])
        user_ids = resolve_legacy_ids(User, [row["adminId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            admin_id = user_ids.get(row["adminId"])
            if admin_id is None:
                failed.append(f"{row['id']}: adminId no resuelto en Django")
                continue
            activity_id = activity_ids.get(row["activityId"])
            if activity_id is None:
                failed.append(f"{row['id']}: activityId legacy '{row['activityId']}' sin TaskActivity Django resuelta")
                continue
            instances.append(
                ActivityAuditLog(
                    legacy_postgres_id=row["id"],
                    activity_id=activity_id,
                    admin_id=admin_id,
                    old_duration=row["oldDuration"],
                    new_duration=row["newDuration"],
                    comment=row["comment"],
                    modified_at=_aware(row["modifiedAt"]),
                )
            )

        created = bulk_import_rows(ActivityAuditLog, instances, batch_size=200)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
