"""Importa `ExecutiveReportSnapshot` desde PostgreSQL (Next.js legacy) —
Wave 1 de la migración de datos reales (ver docs/AUDIT_LOG.md §
2026-08-27, Fase 80). Depende solo de `User`. `ExecutiveReportAuditLog`
(Wave 2) es independiente en cuanto a FK (referencia suelta por
`reportId`, no requiere este comando para migrarse, pero se recomienda
migrar en este orden por prolijidad de datos).

`collaboratorIds` se copia TAL CUAL (cuids de Postgres, nunca se
resuelve a ids de Django) — así lo dejó la Fase 57, ver
`docs/ROADMAP.md`. Tabla con JSON grandes (`data`/`nova`/`dataQuality`/
`filters`) — `batch_size` explícito chico."""

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
from apps.reports.models import ExecutiveReportSnapshot
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa Snapshots de Reportes Ejecutivos desde ExecutiveReportSnapshot de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "reportId", type, scope, origin, "integrityFlag", '
                '"legacyMonthlyReportId", "migratedAt", "generatedBy", "generatedAt", '
                '"periodLabel", "periodStart", "periodEnd", "fechaCorte", "periodStatus", '
                'filters, "collaboratorIds", "collaboratorCount", "analyticsEngineVersion", '
                '"formulaSetVersion", "reportingEngineVersion", "nexoVersion", data, nova, '
                '"novaDegraded", "dataQuality", "generationMs", "createdAt" '
                'FROM "ExecutiveReportSnapshot" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(ExecutiveReportSnapshot, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_ids = resolve_legacy_ids(User, [row["generatedBy"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            generated_by_id = user_ids.get(row["generatedBy"])
            if generated_by_id is None:
                failed.append(f"{row['id']}: usuario generatedBy no resuelto en Django")
                continue
            instances.append(
                ExecutiveReportSnapshot(
                    legacy_postgres_id=row["id"],
                    report_id=row["reportId"],
                    type=row["type"],
                    scope=row["scope"],
                    origin=row["origin"],
                    integrity_flag=row["integrityFlag"],
                    legacy_monthly_report_id=row["legacyMonthlyReportId"],
                    migrated_at=_aware(row["migratedAt"]),
                    generated_by_id=generated_by_id,
                    generated_at=_aware(row["generatedAt"]),
                    period_label=row["periodLabel"],
                    period_start=_aware(row["periodStart"]),
                    period_end=_aware(row["periodEnd"]),
                    fecha_corte=_aware(row["fechaCorte"]),
                    period_status=row["periodStatus"],
                    filters=row["filters"] or {},
                    collaborator_ids=row["collaboratorIds"] or [],
                    collaborator_count=row["collaboratorCount"],
                    analytics_engine_version=row["analyticsEngineVersion"],
                    formula_set_version=row["formulaSetVersion"],
                    reporting_engine_version=row["reportingEngineVersion"],
                    nexo_version=row["nexoVersion"],
                    data=row["data"] or {},
                    nova=row["nova"],
                    nova_degraded=row["novaDegraded"],
                    data_quality=row["dataQuality"] or {},
                    generation_ms=row["generationMs"],
                    created_at=_aware(row["createdAt"]),
                )
            )

        created = bulk_import_rows(ExecutiveReportSnapshot, instances, batch_size=25)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
