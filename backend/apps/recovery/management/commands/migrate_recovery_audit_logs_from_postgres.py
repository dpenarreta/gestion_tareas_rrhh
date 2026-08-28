"""Importa `RecoveryAuditLog` desde PostgreSQL (Next.js legacy) — Wave 4
de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende de `User` (opcional — nulo cuando `origin=AUTOMATIC`,
purga por expiración sin actor humano)."""

from datetime import timezone as dt_timezone

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.legacy_migration import (
    bulk_import_rows,
    fetch_legacy_rows,
    filter_not_yet_imported,
    legacy_postgres_connection,
    resolve_legacy_ids,
)
from apps.recovery.models import RecoveryAuditLog
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa la auditoría del Centro de Recuperación desde RecoveryAuditLog de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "entityType", "entityId", "moduleLabel", "userId", operation, origin, "createdAt" '
                'FROM "RecoveryAuditLog" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(RecoveryAuditLog, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_ids = resolve_legacy_ids(User, [row["userId"] for row in pending_rows if row["userId"]])

        instances = [
            RecoveryAuditLog(
                legacy_postgres_id=row["id"],
                entity_type=row["entityType"],
                entity_id=row["entityId"],
                module_label=row["moduleLabel"],
                user_id=user_ids.get(row["userId"]) if row["userId"] else None,
                operation=row["operation"],
                origin=row["origin"],
                created_at=_aware(row["createdAt"]),
            )
            for row in pending_rows
        ]

        created = bulk_import_rows(RecoveryAuditLog, instances, batch_size=200)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
