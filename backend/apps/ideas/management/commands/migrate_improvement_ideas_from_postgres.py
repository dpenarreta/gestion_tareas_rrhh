"""Importa `ImprovementIdea` desde PostgreSQL (Next.js legacy) — Wave 1
de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende solo de `User`. `IdeaVote`/`IdeaStatusHistory` (Wave 2)
dependen de este comando por `ideaId`.

`attachmentUrl` de Prisma es en realidad el NOMBRE del archivo (no una
URL, ver `apps/ideas/models.py`) — se mapea a `attachment_name` tal
cual. `attachment_mime` no tiene equivalente en Prisma (vivía embebido
en el data URL de `attachmentData`) — se extrae con
`parse_data_url_mime`, mismo criterio que documenta el modelo Django."""

from datetime import timezone as dt_timezone

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.core.legacy_migration import (
    bulk_import_rows,
    fetch_legacy_rows,
    filter_not_yet_imported,
    legacy_postgres_connection,
    parse_data_url_mime,
    resolve_legacy_ids,
)
from apps.ideas.models import ImprovementIdea
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa Mejora Continua desde ImprovementIdea de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, title, description, impact, status, progress, "authorId", '
                '"attachmentUrl", "attachmentData", "createdAt", "updatedAt" '
                'FROM "ImprovementIdea" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(ImprovementIdea, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        user_ids = resolve_legacy_ids(User, [row["authorId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            author_id = user_ids.get(row["authorId"])
            if author_id is None:
                failed.append(f"{row['id']}: usuario authorId no resuelto en Django")
                continue
            instances.append(
                ImprovementIdea(
                    legacy_postgres_id=row["id"],
                    title=row["title"],
                    description=row["description"],
                    impact=row["impact"],
                    status=row["status"],
                    progress=row["progress"],
                    author_id=author_id,
                    attachment_name=row["attachmentUrl"],
                    attachment_mime=parse_data_url_mime(row["attachmentData"]),
                    attachment_data=row["attachmentData"],
                    created_at=_aware(row["createdAt"]),
                    updated_at=_aware(row["updatedAt"]),
                )
            )

        created = bulk_import_rows(ImprovementIdea, instances, batch_size=100)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
