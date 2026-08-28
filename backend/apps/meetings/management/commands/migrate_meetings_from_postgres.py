"""Importa `Meeting` desde PostgreSQL (Next.js legacy) — Wave 1 de la
migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase 80).
Depende solo de `User`. `MeetingInvitee` (Wave 2) depende de este
comando por `meetingId`."""

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
from apps.meetings.models import Meeting
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa Reuniones desde Meeting de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, title, description, "hostId", "meetingDate", duration, '
                '"zoomMeetingId", "zoomJoinUrl", "zoomPassword", status, "otterInvited", '
                '"otterSummary", "otterTranscriptUrl", "createdAt", "updatedAt" '
                'FROM "Meeting" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(Meeting, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_ids = resolve_legacy_ids(User, [row["hostId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            host_id = user_ids.get(row["hostId"])
            if host_id is None:
                failed.append(f"{row['id']}: usuario hostId no resuelto en Django")
                continue
            instances.append(
                Meeting(
                    legacy_postgres_id=row["id"],
                    title=row["title"],
                    description=row["description"],
                    host_id=host_id,
                    meeting_date=_aware(row["meetingDate"]),
                    duration=row["duration"],
                    zoom_meeting_id=row["zoomMeetingId"],
                    zoom_join_url=row["zoomJoinUrl"],
                    zoom_password=row["zoomPassword"],
                    status=row["status"],
                    otter_invited=row["otterInvited"],
                    otter_summary=row["otterSummary"],
                    otter_transcript_url=row["otterTranscriptUrl"],
                    created_at=_aware(row["createdAt"]),
                    updated_at=_aware(row["updatedAt"]),
                )
            )

        created = bulk_import_rows(Meeting, instances)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
