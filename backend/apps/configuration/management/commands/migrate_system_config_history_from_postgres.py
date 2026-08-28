"""Importa `SystemConfigHistory` desde PostgreSQL (Next.js legacy) —
Wave 1 de la migración de datos reales (ver docs/AUDIT_LOG.md §
2026-08-27, Fase 80). Depende solo de `User`.

El modelo Django NO hereda `BaseModel` (solo `created_at`, sin
`updated_at` — ver `apps/configuration/models.py`), así que
`bulk_import_rows` no necesita corrección de ningún campo `auto_now`
más allá del `created_at` por defecto."""

from datetime import timezone as dt_timezone

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.configuration.models import SystemConfigHistory
from apps.core.legacy_migration import (
    bulk_import_rows,
    fetch_legacy_rows,
    filter_not_yet_imported,
    legacy_postgres_connection,
    resolve_legacy_ids,
)
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa el historial de configuración desde SystemConfigHistory de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, key, value, "validFrom", "validUntil", "updatedBy", "createdAt" '
                'FROM "SystemConfigHistory" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(SystemConfigHistory, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_ids = resolve_legacy_ids(User, [row["updatedBy"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            updated_by_id = user_ids.get(row["updatedBy"])
            if updated_by_id is None:
                failed.append(f"{row['id']}: usuario updatedBy no resuelto en Django")
                continue
            instances.append(
                SystemConfigHistory(
                    legacy_postgres_id=row["id"],
                    key=row["key"],
                    value=row["value"],
                    valid_from=_aware(row["validFrom"]),
                    valid_until=_aware(row["validUntil"]),
                    updated_by_id=updated_by_id,
                    created_at=_aware(row["createdAt"]),
                )
            )

        created = bulk_import_rows(SystemConfigHistory, instances)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
