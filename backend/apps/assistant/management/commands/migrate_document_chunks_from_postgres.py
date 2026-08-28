"""Importa `DocumentChunk` desde PostgreSQL (Next.js legacy) — Wave 2 de
la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27, Fase
80). Depende de `KnowledgeDocument` (Wave 1).

Sin campos de timestamp — ni el Prisma ni el Django tienen
`createdAt`/`updatedAt` para este modelo (ver `apps/assistant/models.py`),
así que no hay corrección de `auto_now` que aplicar. `embedding` es el
vector ya calculado en TypeScript, se copia tal cual (JSON)."""

from django.core.management.base import BaseCommand, CommandError

from apps.assistant.models import DocumentChunk, KnowledgeDocument
from apps.core.legacy_migration import (
    bulk_import_rows,
    fetch_legacy_rows,
    filter_not_yet_imported,
    legacy_postgres_connection,
    resolve_legacy_ids,
)


class Command(BaseCommand):
    help = "Importa chunks de la Base de Conocimiento desde DocumentChunk de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "documentId", content, embedding, "pageNumber", "chunkIndex" '
                'FROM "DocumentChunk" ORDER BY "documentId", "chunkIndex"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(DocumentChunk, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        document_ids = resolve_legacy_ids(KnowledgeDocument, [row["documentId"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            document_id = document_ids.get(row["documentId"])
            if document_id is None:
                failed.append(f"{row['id']}: documentId no resuelto en Django")
                continue
            instances.append(
                DocumentChunk(
                    legacy_postgres_id=row["id"],
                    document_id=document_id,
                    content=row["content"],
                    embedding=row["embedding"],
                    page_number=row["pageNumber"],
                    chunk_index=row["chunkIndex"],
                )
            )

        created = bulk_import_rows(DocumentChunk, instances, batch_size=50)

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
