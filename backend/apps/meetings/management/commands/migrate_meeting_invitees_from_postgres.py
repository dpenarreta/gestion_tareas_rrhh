"""Importa `MeetingInvitee` desde PostgreSQL (Next.js legacy) — Wave 2
de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende de `Meeting` (Wave 1) + `User`.

El `MeetingInvitee` de Prisma no tiene `createdAt`/`updatedAt` propios
(solo `id`/`meetingId`/`userId`/`attended`), pero el de Django hereda
`BaseModel` como plus de auditoría (ver docstring del modelo en
`apps/meetings/models.py`) — sin ningún timestamp legacy real, ambos
campos quedan en el instante de la corrida de este comando (única
excepción entre los comandos de esta migración: no hay valor legacy
que preservar)."""

from django.core.management.base import BaseCommand, CommandError

from apps.core.legacy_migration import (
    bulk_import_rows,
    fetch_legacy_rows,
    filter_not_yet_imported,
    legacy_postgres_connection,
    resolve_legacy_ids,
)
from apps.meetings.models import Meeting, MeetingInvitee
from apps.users.models import User


class Command(BaseCommand):
    help = "Importa invitados de reuniones desde MeetingInvitee de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "meetingId", "userId", attended FROM "MeetingInvitee" ORDER BY id',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(MeetingInvitee, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        meeting_ids = resolve_legacy_ids(Meeting, [row["meetingId"] for row in pending_rows])
        user_ids = resolve_legacy_ids(User, [row["userId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            meeting_id = meeting_ids.get(row["meetingId"])
            user_id = user_ids.get(row["userId"])
            if meeting_id is None or user_id is None:
                failed.append(f"{row['id']}: meetingId/userId no resuelto en Django")
                continue
            instances.append(
                MeetingInvitee(
                    legacy_postgres_id=row["id"],
                    meeting_id=meeting_id,
                    user_id=user_id,
                    attended=row["attended"],
                )
            )

        created = bulk_import_rows(MeetingInvitee, instances, batch_size=200)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
