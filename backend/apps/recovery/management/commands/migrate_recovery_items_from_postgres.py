"""Importa `RecoveryItem` desde PostgreSQL (Next.js legacy) — Wave 4 de
la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase
80). Depende de `User` (3 FKs: `deletedBy` requerido, `restoredBy`/
`purgedBy` opcionales). Sin dependencia de otra entidad del Centro de
Recuperación — `entity_type`/`entity_id` son referencia SUELTA hacia la
tabla propia de cada módulo (Proyectos, Notas), fuera del alcance de
resolución de este comando (se copian tal cual, como cuids de Postgres,
mismo criterio que `ExecutiveReportSnapshot.collaboratorIds`)."""

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
from apps.recovery.models import RecoveryItem
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa la Papelera desde RecoveryItem de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "entityType", "entityId", "entityLabel", "moduleLabel", status, '
                '"deletedById", "deletedAt", "retentionHours", "expiresAt", "restoredById", '
                '"restoredAt", "purgedById", "purgedAt", "purgeOrigin", "createdAt" '
                'FROM "RecoveryItem" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(RecoveryItem, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_legacy_ids = set()
        for row in pending_rows:
            user_legacy_ids.add(row["deletedById"])
            if row["restoredById"]:
                user_legacy_ids.add(row["restoredById"])
            if row["purgedById"]:
                user_legacy_ids.add(row["purgedById"])
        user_ids = resolve_legacy_ids(User, user_legacy_ids)

        instances = []
        failed = []
        for row in pending_rows:
            deleted_by_id = user_ids.get(row["deletedById"])
            if deleted_by_id is None:
                failed.append(f"{row['id']}: usuario deletedById no resuelto en Django")
                continue
            instances.append(
                RecoveryItem(
                    legacy_postgres_id=row["id"],
                    entity_type=row["entityType"],
                    entity_id=row["entityId"],
                    entity_label=row["entityLabel"],
                    module_label=row["moduleLabel"],
                    status=row["status"],
                    deleted_by_id=deleted_by_id,
                    deleted_at=_aware(row["deletedAt"]),
                    retention_hours=row["retentionHours"],
                    expires_at=_aware(row["expiresAt"]),
                    restored_by_id=user_ids.get(row["restoredById"]) if row["restoredById"] else None,
                    restored_at=_aware(row["restoredAt"]),
                    purged_by_id=user_ids.get(row["purgedById"]) if row["purgedById"] else None,
                    purged_at=_aware(row["purgedAt"]),
                    purge_origin=row["purgeOrigin"],
                    created_at=_aware(row["createdAt"]),
                )
            )

        created = bulk_import_rows(RecoveryItem, instances, batch_size=200)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
