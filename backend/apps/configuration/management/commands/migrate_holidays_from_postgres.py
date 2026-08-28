"""Importa el catálogo de feriados (`Holiday`) desde la tabla `Holiday`
de PostgreSQL (Next.js legacy) — Wave 0 de la migración de datos reales
(ver docs/AUDIT_LOG.md § 2026-08-27, Fase 80). Sin dependencias de otras
entidades: es una de las 2 entidades de Wave 0 junto con `ActivityReason`.

Solo LEE de Postgres (nunca escribe) y es idempotente vía
`filter_not_yet_imported` (ver `apps.core.legacy_migration` — el backend
de SQL Server no soporta `bulk_create(ignore_conflicts=True)`, así que la
idempotencia se logra filtrando ANTES de construir las instancias, no
dejando que la base de datos ignore el conflicto).

El `Holiday` de Prisma no tiene `updatedAt` (solo `createdAt`, ver
`prisma/schema.prisma`), pero el `Holiday` de Django hereda de
`BaseModel` (`created_at`/`updated_at`, ambos obligatorios y ambos
corregidos por `bulk_import_rows` tras el `bulk_create`, ver
`apps.core.legacy_migration`) — sin pasar un valor propio la inserción
falla por NOT NULL. Sin un `updatedAt` legacy real, se usa el mismo
valor que `created_at` (no hay noción de "última edición" en los datos
de origen)."""

from datetime import timezone as dt_timezone

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.configuration.models import Holiday
from apps.core.legacy_migration import (
    bulk_import_rows,
    fetch_legacy_rows,
    filter_not_yet_imported,
    legacy_postgres_connection,
)


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa el catálogo de feriados desde Holiday de PostgreSQL (Next.js legacy)."

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
                'SELECT id, date, name, year, "createdAt" FROM "Holiday" ORDER BY date',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(Holiday, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(
                self.style.SUCCESS(
                    f"[dry-run] A importar: {len(pending_rows)}. Ya existentes (se omitirían): {skipped}."
                )
            )
            return

        instances = []
        for row in pending_rows:
            created_at = _aware(row["createdAt"])
            instances.append(
                Holiday(
                    legacy_postgres_id=row["id"],
                    date=row["date"],
                    name=row["name"],
                    year=row["year"],
                    created_at=created_at,
                    updated_at=created_at,
                )
            )

        created = bulk_import_rows(Holiday, instances)

        self.stdout.write(
            self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}.")
        )
