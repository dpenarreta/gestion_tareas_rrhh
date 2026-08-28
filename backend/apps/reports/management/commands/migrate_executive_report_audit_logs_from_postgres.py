"""Importa `ExecutiveReportAuditLog` desde PostgreSQL (Next.js legacy) —
Wave 2 de la migración de datos reales (ver docs/AUDIT_LOG.md §
2026-08-27, Fase 80). Depende de `User`; NO depende de
`ExecutiveReportSnapshot` (Wave 1) porque `report_id` es una referencia
SUELTA (el Report ID de negocio NXR-..., no un id de fila) — se copia
tal cual, sin `resolve_legacy_ids`, mismo criterio en ambos sistemas."""

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
from apps.reports.models import ExecutiveReportAuditLog
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa la auditoría del Executive Reporting Engine desde ExecutiveReportAuditLog de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "reportId", action, "userId", step, message, period, "fechaCorte", '
                '"filtersApplied", "collaboratorCount", "generationMs", "analyticsEngineVersion", '
                '"formulaSetVersion", "nexoVersion", "createdAt" '
                'FROM "ExecutiveReportAuditLog" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(ExecutiveReportAuditLog, legacy_ids)
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
                failed.append(f"{row['id']}: userId no resuelto en Django")
                continue
            instances.append(
                ExecutiveReportAuditLog(
                    legacy_postgres_id=row["id"],
                    report_id=row["reportId"],
                    action=row["action"],
                    user_id=user_id,
                    step=row["step"],
                    message=row["message"],
                    period=row["period"],
                    fecha_corte=_aware(row["fechaCorte"]),
                    filters_applied=row["filtersApplied"],
                    collaborator_count=row["collaboratorCount"],
                    generation_ms=row["generationMs"],
                    analytics_engine_version=row["analyticsEngineVersion"],
                    formula_set_version=row["formulaSetVersion"],
                    nexo_version=row["nexoVersion"],
                    created_at=_aware(row["createdAt"]),
                )
            )

        created = bulk_import_rows(ExecutiveReportAuditLog, instances, batch_size=100)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
