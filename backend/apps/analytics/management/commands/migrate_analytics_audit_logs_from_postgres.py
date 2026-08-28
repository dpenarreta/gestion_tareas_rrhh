"""Importa `AnalyticsAuditLog` desde PostgreSQL (Next.js legacy) — Wave 1
de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende solo de `User`.

Tabla potencialmente grande (un registro por cálculo de Score/Riesgo
Operativo, histórico completo) — `batch_size` explícito más chico que
el default para no acumular demasiadas filas de `inputs`/`result` (JSON)
en un solo lote de `bulk_create`."""

from datetime import timezone as dt_timezone

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.analytics.models import AnalyticsAuditLog
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
    help = "Importa la auditoría del motor de Analytics desde AnalyticsAuditLog de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "userId", kind, period, inputs, result, "engineVersion", "createdAt" '
                'FROM "AnalyticsAuditLog" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(AnalyticsAuditLog, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_ids = resolve_legacy_ids(User, [row["userId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            user_id = user_ids.get(row["userId"])
            if user_id is None:
                failed.append(f"{row['id']}: usuario userId no resuelto en Django")
                continue
            instances.append(
                AnalyticsAuditLog(
                    legacy_postgres_id=row["id"],
                    user_id=user_id,
                    kind=row["kind"],
                    period=row["period"],
                    inputs=row["inputs"] or {},
                    result=row["result"] or {},
                    engine_version=row["engineVersion"],
                    created_at=_aware(row["createdAt"]),
                )
            )

        created = bulk_import_rows(AnalyticsAuditLog, instances, batch_size=100)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
