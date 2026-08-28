"""Importa `TargetTimeAuditLog` desde PostgreSQL (Next.js legacy) — Wave
2 de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende de `Task` (Wave 1, solo para RESOLVER el id numérico
de Django — `task_id` en sí queda como referencia SUELTA, sin FK, igual
que el modelo Prisma original) + `User`.

Una fila cuyo `taskId` legacy no resuelve a ningún `Task` ya importado
se reporta como fallo (no se inventa un `task_id` sentinela) — requiere
correr `migrate_tasks_from_postgres` (Wave 1) completo antes que este
comando."""

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
from apps.tasks.models import TargetTimeAuditLog, Task
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa auditoría de Tiempo Objetivo desde TargetTimeAuditLog de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "taskId", "userId", "userRole", "previousValue", "newValue", reason, '
                '"reasonDetail", "ipAddress", "createdAt" '
                'FROM "TargetTimeAuditLog" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(TargetTimeAuditLog, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        task_ids = resolve_legacy_ids(Task, [row["taskId"] for row in pending_rows])
        user_ids = resolve_legacy_ids(User, [row["userId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            user_id = user_ids.get(row["userId"])
            if user_id is None:
                failed.append(f"{row['id']}: userId no resuelto en Django")
                continue
            task_id = task_ids.get(row["taskId"])
            if task_id is None:
                failed.append(f"{row['id']}: taskId legacy '{row['taskId']}' sin Task Django resuelta (¿Wave 1 corrida completa?)")
                continue
            instances.append(
                TargetTimeAuditLog(
                    legacy_postgres_id=row["id"],
                    task_id=task_id,
                    user_id=user_id,
                    user_role=row["userRole"],
                    previous_value=row["previousValue"],
                    new_value=row["newValue"],
                    reason=row["reason"],
                    reason_detail=row["reasonDetail"],
                    ip_address=row["ipAddress"],
                    created_at=_aware(row["createdAt"]),
                    updated_at=_aware(row["createdAt"]),
                )
            )

        created = bulk_import_rows(TargetTimeAuditLog, instances, batch_size=200)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
