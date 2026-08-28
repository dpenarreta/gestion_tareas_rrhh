"""Importa el catálogo de motivos de registro de horas (`ActivityReason`)
desde la tabla `ActivityReason` de PostgreSQL (Next.js legacy) — Wave 0 de
la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase
80). Sin dependencias de otras entidades: es una de las 2 entidades de
Wave 0 junto con `Holiday`.

Solo LEE de Postgres (nunca escribe) y es idempotente vía
`filter_not_yet_imported` (ver `apps.core.legacy_migration` — el backend
de SQL Server no soporta `bulk_create(ignore_conflicts=True)`, así que la
idempotencia se logra filtrando ANTES de construir las instancias, no
dejando que la base de datos ignore el conflicto).

`created_at`/`updated_at` (`BaseModel`, `auto_now_add`/`auto_now`) se
preservan con el timestamp legacy real — Django dispara esos campos
igual durante `bulk_create` (ver `apps.core.legacy_migration`, hallazgo
1 del docstring del módulo), así que `bulk_import_rows` los corrige con
un `bulk_update()` inmediatamente después; este comando solo necesita
setear el valor legacy en la instancia antes de llamarlo."""

from datetime import timezone as dt_timezone

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.legacy_migration import (
    bulk_import_rows,
    fetch_legacy_rows,
    filter_not_yet_imported,
    legacy_postgres_connection,
)
from apps.tasks.models import ActivityReason


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa el catálogo de motivos de registro de horas desde ActivityReason de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Solo reporta qué se importaría, sin escribir en la base de datos.",
        )

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, key, label, description, "isActive", "isArchived", '
                '"archivedAt", "assignedRoles", "createdAt", "updatedAt" '
                'FROM "ActivityReason" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(ActivityReason, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(
                self.style.SUCCESS(
                    f"[dry-run] A importar: {len(pending_rows)}. Ya existentes (se omitirían): {skipped}."
                )
            )
            return

        instances = [
            ActivityReason(
                legacy_postgres_id=row["id"],
                key=row["key"],
                label=row["label"],
                description=row["description"] or "",
                is_active=row["isActive"],
                is_archived=row["isArchived"],
                archived_at=_aware(row["archivedAt"]),
                assigned_roles=row["assignedRoles"] or [],
                created_at=_aware(row["createdAt"]),
                updated_at=_aware(row["updatedAt"]),
            )
            for row in pending_rows
        ]

        created = bulk_import_rows(ActivityReason, instances)

        self.stdout.write(
            self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}.")
        )
