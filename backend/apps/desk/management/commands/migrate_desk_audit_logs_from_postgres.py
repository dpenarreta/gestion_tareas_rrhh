"""Importa `DeskAuditLog` desde PostgreSQL (Next.js legacy) — Wave 4 de
la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase
80). Depende de `DeskNote`/`PersonalReminder` (Waves 2-3, para resolver
`entity_id`) + `User`.

A diferencia de las demás referencias sueltas de esta migración
(`CharField` con el cuid legacy tal cual), acá el Django
`entity_id` es un `PositiveBigIntegerField` (ver
`apps/desk/models.py`) — SÍ hay que resolver el id numérico de
Django, pero el modelo destino depende de `entity_type` por fila:
`"NOTE"` resuelve contra `DeskNote`, `"REMINDER"` contra
`PersonalReminder` (mismos 2 valores en ambos sistemas, confirmado
contra `src/components/desk/DeskHistoryModal.tsx`)."""

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
from apps.desk.models import DeskAuditLog, DeskNote, PersonalReminder
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa la auditoría del Escritorio Digital desde DeskAuditLog de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "entityType", "entityId", "userId", action, metadata, "createdAt" '
                'FROM "DeskAuditLog" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(DeskAuditLog, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        note_ids = resolve_legacy_ids(
            DeskNote, [row["entityId"] for row in pending_rows if row["entityType"] == "NOTE"]
        )
        reminder_ids = resolve_legacy_ids(
            PersonalReminder, [row["entityId"] for row in pending_rows if row["entityType"] == "REMINDER"]
        )
        user_ids = resolve_legacy_ids(User, [row["userId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            user_id = user_ids.get(row["userId"])
            if user_id is None:
                failed.append(f"{row['id']}: userId no resuelto en Django")
                continue
            if row["entityType"] == "NOTE":
                entity_id = note_ids.get(row["entityId"])
            elif row["entityType"] == "REMINDER":
                entity_id = reminder_ids.get(row["entityId"])
            else:
                entity_id = None
            if entity_id is None:
                failed.append(f"{row['id']}: entityId ({row['entityType']}) no resuelto en Django")
                continue
            instances.append(
                DeskAuditLog(
                    legacy_postgres_id=row["id"],
                    entity_type=row["entityType"],
                    entity_id=entity_id,
                    user_id=user_id,
                    action=row["action"],
                    metadata=row["metadata"],
                    created_at=_aware(row["createdAt"]),
                )
            )

        created = bulk_import_rows(DeskAuditLog, instances, batch_size=200)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
