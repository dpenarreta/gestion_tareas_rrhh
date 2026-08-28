"""Importa `ProjectDocument` desde PostgreSQL (Next.js legacy) — Wave 4
de la migración de datos reales (ver docs/AUDIT_LOG.md § 2026-08-27,
Fase 80). Depende de `Project` (Wave 1) + `ProjectActivity` (Wave 3,
opcional) + `User`.

`previousVersionId` es una referencia SUELTA (sin FK) hacia OTRO
`ProjectDocument` — a diferencia del resto de referencias sueltas de
esta migración, acá el id de Django SÍ se resuelve (el modelo Django
usa `IntegerField`, no un `CharField`, ver `apps/projects/models.py`),
pero no se puede resolver en la misma pasada que el `bulk_create`: la
versión anterior puede estar en el mismo lote, todavía sin id de
Django asignado. Se resuelve en una SEGUNDA pasada, después de que
todas las filas de este comando ya existen: se releen por
`legacy_postgres_id`, se arma `{id_django: previous_version_id_django}`
y se corrige con `bulk_update` (mismo mecanismo de 2 fases que ya usa
`bulk_import_rows` para `auto_now`, aplicado acá a mano porque es un
campo de negocio, no un timestamp automático)."""

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
from apps.projects.models import Project, ProjectActivity, ProjectDocument
from apps.users.models import User


def _aware(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, dt_timezone.utc)
    return value


class Command(BaseCommand):
    help = "Importa documentos de proyectos desde ProjectDocument de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = legacy_postgres_connection()
        try:
            rows = fetch_legacy_rows(
                connection,
                'SELECT id, "projectId", "activityId", category, "fileName", "mimeType", '
                '"fileData", version, "previousVersionId", "uploadedById", "createdAt" '
                'FROM "ProjectDocument" ORDER BY "createdAt"',
            )
        finally:
            connection.close()

        legacy_ids = [row["id"] for row in rows]
        pending_ids = filter_not_yet_imported(ProjectDocument, legacy_ids)
        pending_rows = [row for row in rows if row["id"] in pending_ids]
        skipped = len(rows) - len(pending_rows)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"[dry-run] A importar: {len(pending_rows)}. Ya existentes: {skipped}."))
            return

        project_ids = resolve_legacy_ids(Project, [row["projectId"] for row in pending_rows])
        activity_ids = resolve_legacy_ids(
            ProjectActivity, [row["activityId"] for row in pending_rows if row["activityId"]]
        )
        user_ids = resolve_legacy_ids(User, [row["uploadedById"] for row in pending_rows])

        instances = []
        failed = []
        for row in pending_rows:
            project_id = project_ids.get(row["projectId"])
            uploaded_by_id = user_ids.get(row["uploadedById"])
            if project_id is None or uploaded_by_id is None:
                failed.append(f"{row['id']}: projectId/uploadedById no resuelto en Django")
                continue
            created_at = _aware(row["createdAt"])
            instances.append(
                ProjectDocument(
                    legacy_postgres_id=row["id"],
                    project_id=project_id,
                    activity_id=activity_ids.get(row["activityId"]) if row["activityId"] else None,
                    category=row["category"],
                    file_name=row["fileName"],
                    mime_type=row["mimeType"] or "",
                    file_data=row["fileData"],
                    version=row["version"],
                    previous_version_id=None,
                    uploaded_by_id=uploaded_by_id,
                    created_at=created_at,
                    updated_at=created_at,
                )
            )

        created = bulk_import_rows(ProjectDocument, instances, batch_size=25)

        # Segunda pasada: resuelve previousVersionId ahora que todas las
        # filas de esta corrida ya existen en Django.
        pending_with_previous = [row for row in pending_rows if row["previousVersionId"]]
        if pending_with_previous:
            all_relevant_legacy_ids = {row["id"] for row in pending_with_previous} | {
                row["previousVersionId"] for row in pending_with_previous
            }
            doc_ids = resolve_legacy_ids(ProjectDocument, all_relevant_legacy_ids)
            to_update = []
            for row in pending_with_previous:
                self_id = doc_ids.get(row["id"])
                previous_id = doc_ids.get(row["previousVersionId"])
                if self_id is None or previous_id is None:
                    continue
                doc = ProjectDocument(pk=self_id, previous_version_id=previous_id)
                to_update.append(doc)
            if to_update:
                ProjectDocument.objects.bulk_update(to_update, ["previous_version_id"])

        self.stdout.write(self.style.SUCCESS(f"Importados: {created}. Ya existentes (omitidos): {skipped}."))
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
        if failed:
            raise CommandError(f"{len(failed)} filas no se pudieron importar — ver detalle arriba.")
