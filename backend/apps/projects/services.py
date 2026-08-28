"""Lógica de negocio del módulo Proyectos — Fases 5a-5e (ver
docs/AUDIT_LOG.md § 2026-08-13/2026-08-14). Réplica campo por campo de
las rutas legacy (`src/app/api/projects/**`). Solo Papelera queda
fuera de alcance — ver plan de Fase 5e."""

from datetime import datetime
from datetime import timezone as dt_timezone

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers as drf_serializers

from apps.configuration.services import get_effective_retroactive_window_days
from apps.core.rounding import round_half_up
from apps.tasks.business_time import (
    business_calendar_day,
    business_day_real_range,
    parse_date_only,
    retroactive_valid_dates,
    time_to_minutes,
)

from .models import (
    Project,
    ProjectActivity,
    ProjectComment,
    ProjectDocument,
    ProjectHistory,
    ProjectHistoryEvent,
    ProjectParticipant,
    ProjectPhase,
)

# Sprint 2.1 §7 del TS — descripción obligatoria, mínimo 15 caracteres.
MIN_DESCRIPTION_LENGTH = 15


def log_project_history(
    *, project_id, actor, event: str, description: str, previous_value: dict | None = None, new_value: dict | None = None
) -> None:
    """Réplica exacta de `logProjectHistory` — un registro por evento
    relevante, nunca editado ni eliminado."""
    ProjectHistory.objects.create(
        project_id=project_id, actor=actor, event=event, description=description,
        previous_value=previous_value, new_value=new_value,
    )


class ProjectService:
    @staticmethod
    def create_project(*, actor, participant_ids: list, **fields) -> Project:
        """Réplica de `POST /api/projects`. Sprint 2.1: el responsable
        (y el creador) ya NO se agregan automáticamente como
        participantes — solo se crean filas de `ProjectParticipant`
        para los ids explícitamente elegidos."""
        with transaction.atomic():
            project = Project.objects.create(created_by=actor, **fields)
            unique_participant_ids = dict.fromkeys(participant_ids or [])
            for user_id in unique_participant_ids:
                ProjectParticipant.objects.create(project=project, user_id=user_id, added_by=actor)

            log_project_history(
                project_id=project.id, actor=actor, event=ProjectHistoryEvent.CREADO,
                description=f'{actor.first_name or actor.username} creó el proyecto "{project.name}"',
                new_value={"name": project.name, "status": project.status, "responsible_id": project.responsible_id},
            )
        return project

    @staticmethod
    def update_project(*, actor, project: Project, fields: dict) -> Project:
        """Réplica de `PATCH /api/projects/[id]`. Ediciones de campos no
        estratégicos (nombre/descripción/área/etiquetas/observaciones/
        fechas/tiempo objetivo) NO generan evento de historial — solo
        cambio de estado y de responsable (Sprint 2.1 §1). `responsible`,
        si viene, ya es una instancia de `User` válida (resuelta y
        validada por `PrimaryKeyRelatedField` en el serializer, mismo
        patrón que `assigned_to` en `TaskUpdateSerializer`) — no hace
        falta re-validar su existencia aquí."""
        previous_status = project.status
        previous_responsible_id = project.responsible_id

        new_status = fields.get("status")
        status_changed = "status" in fields and new_status != previous_status
        if status_changed:
            fields["completed_at"] = timezone.now() if new_status == Project.Status.COMPLETADO else None

        new_responsible = fields.get("responsible")
        responsible_changed = "responsible" in fields and new_responsible.id != previous_responsible_id

        with transaction.atomic():
            for field, value in fields.items():
                setattr(project, field, value)
            project.save()

            if responsible_changed:
                ProjectParticipant.objects.get_or_create(
                    project=project, user=new_responsible, defaults={"added_by": actor}
                )

            if status_changed:
                log_project_history(
                    project_id=project.id, actor=actor, event=ProjectHistoryEvent.ESTADO_CAMBIADO,
                    description=f'{actor.first_name or actor.username} cambió el estado de "{project.name}" de {previous_status} a {new_status}',
                    previous_value={"status": previous_status}, new_value={"status": new_status},
                )
            if responsible_changed:
                log_project_history(
                    project_id=project.id, actor=actor, event=ProjectHistoryEvent.RESPONSABLE_CAMBIADO,
                    description=f'{actor.first_name or actor.username} cambió el responsable principal de "{project.name}"',
                    previous_value={"responsible_id": previous_responsible_id}, new_value={"responsible_id": new_responsible.id},
                )
        return project

    @staticmethod
    def soft_delete_project(*, actor, project: Project) -> None:
        """Réplica de `DELETE /api/projects/[id]` (mueve a la
        papelera) — Fase 14 (ver docs/AUDIT_LOG.md § 2026-08-20): pasa
        por el Centro de Recuperación (`apps.recovery.services.
        move_to_trash`), que es quien marca `project.deleted_at` (vía
        su adaptador PROJECT) — este método ya no lo toca directo.
        Propaga `RecoveryError` tal cual (la vista la traduce a 409)."""
        from apps.recovery.services import move_to_trash

        name = project.name
        with transaction.atomic():
            move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=actor)
            log_project_history(
                project_id=project.id, actor=actor, event=ProjectHistoryEvent.ELIMINADO,
                description=f'{actor.first_name or actor.username} movió el proyecto "{name}" a la papelera',
            )

    @staticmethod
    def restore_project(*, actor, project: Project) -> None:
        """Réplica de `POST /api/projects/[id]/restore` — Fase 14 (ver
        docs/AUDIT_LOG.md § 2026-08-20). Propaga `RecoveryError` tal
        cual (la vista la traduce a 409)."""
        from apps.recovery.services import restore

        name = project.name
        with transaction.atomic():
            restore(entity_type="PROJECT", entity_id=str(project.id), user=actor)
            log_project_history(
                project_id=project.id, actor=actor, event=ProjectHistoryEvent.RESTAURADO,
                description=f'{actor.first_name or actor.username} restauró el proyecto "{name}" desde la papelera',
            )

    @staticmethod
    def delete_project_permanently(*, actor, project: Project) -> None:
        """Réplica de `DELETE /api/projects/[id]/permanent` — Fase 14
        (ver docs/AUDIT_LOG.md § 2026-08-20). Irreversible: borra la
        fila física (cascada sobre fases/participantes/actividades/
        comentarios/documentos/historial — todas con `on_delete=CASCADE`
        hacia `Project`). El registro de auditoría sobrevive en
        `RecoveryAuditLog` (referencia suelta, sin FK). Sin evento de
        `ProjectHistory`: la fila (y su historial) dejan de existir.
        Propaga `RecoveryError` tal cual (la vista la traduce a 409)."""
        from apps.recovery.services import delete_permanently

        delete_permanently(entity_type="PROJECT", entity_id=str(project.id), user=actor)


class ParticipantService:
    """Fase 5b — réplica de `POST /participants` y
    `DELETE /participants/[participantId]`. Las validaciones de
    "ya es participante"/"es el responsable" viven en `views.py` (mismo
    criterio que `ActivityDetailView`/`CloseMonthView` en
    `apps/tasks/views.py`: chequeo inline en la vista, que responde el
    status HTTP exacto — 409 — antes de delegar la mutación aquí)."""

    @staticmethod
    def add_participant(*, actor, project: Project, user) -> ProjectParticipant:
        participant = ProjectParticipant.objects.create(project=project, user=user, added_by=actor)
        log_project_history(
            project_id=project.id, actor=actor, event=ProjectHistoryEvent.PARTICIPANTE_AGREGADO,
            description=f'{actor.first_name or actor.username} agregó a {user.first_name or user.username} como participante de "{project.name}"',
            new_value={"user_id": user.id},
        )
        return participant

    @staticmethod
    def remove_participant(*, actor, project: Project, participant: ProjectParticipant) -> None:
        removed_user = participant.user
        participant.delete()
        log_project_history(
            project_id=project.id, actor=actor, event=ProjectHistoryEvent.PARTICIPANTE_ELIMINADO,
            description=f'{actor.first_name or actor.username} quitó a {removed_user.first_name or removed_user.username} del proyecto "{project.name}"',
            previous_value={"user_id": removed_user.id},
        )


class CommentService:
    """Fase 5b — réplica de `POST /comments`. Sprint 2.1 §1 del TS: NO
    genera evento de `ProjectHistory` (los comentarios tienen su propia
    pestaña cronológica)."""

    @staticmethod
    def create_comment(*, project: Project, author, text: str) -> ProjectComment:
        return ProjectComment.objects.create(project=project, author=author, text=text.strip())


class PhaseService:
    """Fase 5c — réplica de `POST /phases` y
    `PATCH|DELETE /phases/[phaseId]`."""

    @staticmethod
    def create_phase(*, actor, project: Project, **fields) -> ProjectPhase:
        order = ProjectPhase.objects.filter(project=project).count()
        phase = ProjectPhase.objects.create(project=project, order=order, **fields)
        log_project_history(
            project_id=project.id, actor=actor, event=ProjectHistoryEvent.FASE_AGREGADA,
            description=f'{actor.first_name or actor.username} agregó la fase "{phase.name}" a "{project.name}"',
            new_value={"phase_id": phase.id, "name": phase.name},
        )
        return phase

    @staticmethod
    def update_phase(*, actor, project: Project, phase: ProjectPhase, fields: dict) -> ProjectPhase:
        """Sprint 2.1 §1: solo el cambio de `status` genera historial —
        progreso/notas/fechas/responsable son ediciones intermedias sin
        auditar (mismo criterio que `ProjectService.update_project`)."""
        previous_status = phase.status
        new_status = fields.get("status")
        status_changed = "status" in fields and new_status != previous_status

        with transaction.atomic():
            for field, value in fields.items():
                setattr(phase, field, value)
            phase.save()

            if status_changed:
                log_project_history(
                    project_id=project.id, actor=actor, event=ProjectHistoryEvent.FASE_ACTUALIZADA,
                    description=f'{actor.first_name or actor.username} cambió el estado de la fase "{phase.name}" de {previous_status} a {new_status}',
                    previous_value={"status": previous_status}, new_value={"status": new_status},
                )
        return phase

    @staticmethod
    def delete_phase(*, actor, project: Project, phase: ProjectPhase) -> None:
        """Hard delete — el TS tampoco mueve fases a la papelera."""
        name = phase.name
        phase_id = phase.id
        with transaction.atomic():
            phase.delete()
            log_project_history(
                project_id=project.id, actor=actor, event=ProjectHistoryEvent.FASE_ELIMINADA,
                description=f'{actor.first_name or actor.username} eliminó la fase "{name}" de "{project.name}"',
                previous_value={"phase_id": phase_id, "name": name},
            )


class DocumentService:
    """Fase 5d — réplica de `POST /documents`. El chequeo de tamaño
    (`MAX_BASE64_LENGTH`) vive en `views.py` (413 explícito, no una
    validación de campo del serializer) — mismo criterio que los 409
    de `ParticipantService`."""

    @staticmethod
    def upload_document(
        *, actor, project: Project, previous_version_id: int | None = None, activity: ProjectActivity | None = None, **fields
    ) -> ProjectDocument:
        if activity is not None and activity.project_id != project.id:
            raise drf_serializers.ValidationError({"activity": ["Actividad inválida"]})

        version = 1
        if previous_version_id is not None:
            try:
                previous = ProjectDocument.objects.get(id=previous_version_id, project=project)
            except ProjectDocument.DoesNotExist:
                raise drf_serializers.ValidationError({"previous_version_id": ["Versión anterior inválida"]}) from None
            version = previous.version + 1

        document = ProjectDocument.objects.create(
            project=project, uploaded_by=actor, version=version, previous_version_id=previous_version_id,
            activity=activity, **fields
        )
        version_suffix = f" (v{version})" if version > 1 else ""
        log_project_history(
            project_id=project.id, actor=actor, event=ProjectHistoryEvent.DOCUMENTO_AGREGADO,
            description=f'{actor.first_name or actor.username} subió el documento "{document.file_name}"{version_suffix} a "{project.name}"',
            new_value={"document_id": document.id, "file_name": document.file_name, "version": version},
        )
        return document


def recalc_project_real_hours(project: Project) -> None:
    """Réplica exacta de `recalcProjectRealHours` — suma `duration`
    (minutos) de todas las actividades del proyecto y actualiza
    `real_hours`. Función de módulo (no un método de clase), mismo
    criterio que `log_project_history`."""
    total_minutes = ProjectActivity.objects.filter(project=project).aggregate(total=Sum("duration"))["total"] or 0
    project.real_hours = round_half_up(total_minutes / 60, 2)
    project.save(update_fields=["real_hours", "updated_at"])


class ActivityService:
    """Fase 5e — réplica de `POST /activities`. A diferencia de Tareas
    (`apps.tasks.services.ActivityService`), el TS de Proyectos no
    valida solapamiento de horarios ni separa un endpoint
    `/activities/retroactive` — un solo método cubre ambos casos."""

    @staticmethod
    def create_activity(
        *,
        actor,
        project: Project,
        description: str,
        start_time: str,
        end_time: str,
        phase: ProjectPhase | None = None,
        comments: str = "",
        activity_date_raw: str | None = None,
    ) -> ProjectActivity:
        if len(description.strip()) < MIN_DESCRIPTION_LENGTH:
            raise drf_serializers.ValidationError(
                {"description": [f"La descripción es obligatoria y debe tener al menos {MIN_DESCRIPTION_LENGTH} caracteres"]}
            )

        start_mins = time_to_minutes(start_time)
        end_mins = time_to_minutes(end_time)
        if start_mins is None or end_mins is None:
            raise drf_serializers.ValidationError({"non_field_errors": ["Hora inválida"]})
        if end_mins <= start_mins:
            raise drf_serializers.ValidationError({"non_field_errors": ["La hora fin debe ser posterior a la hora inicio"]})
        duration = end_mins - start_mins

        if phase is not None and phase.project_id != project.id:
            raise drf_serializers.ValidationError({"phase": ["Fase inválida"]})

        is_retroactive = False
        parsed_date = None
        backdated_created_at = None

        if activity_date_raw:
            parsed_date = parse_date_only(activity_date_raw)
            if parsed_date is None:
                raise drf_serializers.ValidationError({"activity_date": ["Fecha inválida"]})

            now = timezone.now()
            today = business_calendar_day(now)
            if parsed_date != today:
                window_days = get_effective_retroactive_window_days(now)
                valid_dates = retroactive_valid_dates(today, window_days)
                if parsed_date not in valid_dates:
                    raise drf_serializers.ValidationError(
                        {
                            "activity_date": [
                                f"La fecha debe ser hoy, uno de los últimos {window_days} días laborables, o el "
                                "sábado/domingo inmediato anterior si aún está disponible"
                            ]
                        }
                    )
                is_retroactive = True
                backdated_created_at, _ = business_day_real_range(parsed_date)

        activity_date_dt = (
            datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=dt_timezone.utc) if parsed_date else None
        )

        with transaction.atomic():
            activity = ProjectActivity.objects.create(
                project=project, phase=phase, author=actor, description=description.strip(),
                comments=comments.strip() or None, start_time=start_time, end_time=end_time, duration=duration,
                is_retroactive=is_retroactive, activity_date=activity_date_dt,
            )
            if backdated_created_at is not None:
                ProjectActivity.objects.filter(pk=activity.pk).update(created_at=backdated_created_at)
                activity.created_at = backdated_created_at

            recalc_project_real_hours(project)

            # Sprint 2.1 §2: "participante" se gana por asignación explícita
            # O por registrar actividad — si el autor todavía no figura como
            # participante, se lo agrega automáticamente (evento SÍ relevante
            # de negocio, a diferencia del registro de la actividad en sí,
            # que NO genera historial — Sprint 2.1 §1).
            if not ProjectParticipant.objects.filter(project=project, user=actor).exists():
                ProjectParticipant.objects.create(project=project, user=actor, added_by=actor)
                log_project_history(
                    project_id=project.id, actor=actor, event=ProjectHistoryEvent.PARTICIPANTE_AGREGADO,
                    description=f'{actor.first_name or actor.username} se agregó automáticamente como participante de "{project.name}" al registrar una actividad',
                    new_value={"user_id": actor.id, "auto": True},
                )

        return activity
