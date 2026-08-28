"""Importa `DataSubjectRequest` desde PostgreSQL (Next.js legacy) — Wave
1 de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende solo de `User`.

El `DataSubjectRequest` de Prisma no tiene `updatedAt` (solo
`createdAt`), pero el de Django hereda `BaseModel` — sin un `updatedAt`
legacy real, se usa el mismo valor que `created_at`."""

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
from apps.data_requests.models import DataSubjectRequest
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa Solicitudes LOPD desde DataSubjectRequest de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "userId", type, description, status, "resolvedBy", "resolvedAt", "createdAt" '
                'FROM "DataSubjectRequest" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(DataSubjectRequest, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_legacy_ids = set()
        for row in pending_rows:
            user_legacy_ids.add(row["userId"])
            if row["resolvedBy"]:
                user_legacy_ids.add(row["resolvedBy"])
        user_ids = resolve_legacy_ids(User, user_legacy_ids)

        instances = []
        failed = []
        for row in pending_rows:
            user_id = user_ids.get(row["userId"])
            if user_id is None:
                failed.append(f"{row['id']}: usuario userId no resuelto en Django")
                continue
            created_at = _aware(row["createdAt"])
            instances.append(
                DataSubjectRequest(
                    legacy_postgres_id=row["id"],
                    user_id=user_id,
                    type=row["type"],
                    description=row["description"],
                    status=row["status"],
                    resolved_by_id=user_ids.get(row["resolvedBy"]),
                    resolved_at=_aware(row["resolvedAt"]),
                    created_at=created_at,
                    updated_at=created_at,
                )
            )

        created = bulk_import_rows(DataSubjectRequest, instances)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
