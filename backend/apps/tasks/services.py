"""Lógica de negocio del módulo Tareas (Fase 3a de la migración de stack).

Replica, campo por campo, el comportamiento de
`src/app/api/tasks/route.ts` y `src/app/api/tasks/[id]/route.ts` del
Next.js legacy — ver docs/AUDIT_LOG.md § 2026-08-07 para las decisiones de
alcance de esta sub-fase."""

import logging
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.db import transaction
from django.db.models import Q, QuerySet, Sum
from django.utils import timezone
from rest_framework import serializers as drf_serializers

from apps.configuration.services import business_base_for_range
from apps.core.rounding import round_half_up
from apps.hierarchy.services import ROLE_LABEL
from apps.users.models import User

from .business_time import (
    business_calendar_day,
    business_day_real_range,
    parse_date_only,
    ranges_overlap,
    retroactive_valid_dates,
    time_to_minutes,
)
from .closure import (
    RECURRING_FREQUENCIES,
    days_in_month,
    determine_closure_type,
    next_month_start,
    next_year_month,
    period_start,
    resolve_cutoff_date,
    shift_to_next_month,
)
from .models import (
    ActivityAuditLog,
    ActivityComment,
    ActivityReason,
    Comment,
    EndDateAuditLog,
    MonthClosure,
    TargetTimeAuditLog,
    Task,
    TaskActivity,
    TaskCommentView,
)
from .task_import import VALID_FREQUENCIES, VALID_PRIORITIES, VALID_TYPES, parse_date

logger = logging.getLogger(__name__)

# Máximo de registros permitidos para una tarea Fija — mismo umbral que
# `FIJA_MAX_ACTIVITIES` en `src/app/api/tasks/[id]/activities/route.ts`.
FIJA_MAX_ACTIVITIES = 2
FIJA_MAX_ACTIVITIES_MESSAGE = "Esta tarea fija ya alcanzó el número máximo de registros permitidos."

# Solo el propio responsable de la tarea puede tocar estos 3 campos —
# mismo criterio que el Next.js legacy (comentario original: "el
# creador/líder con visibilidad NO puede tocar esos campos").
SELF_ONLY_FIELDS = frozenset({"real_hours", "color", "status"})

# Hasta 40 casos históricos con el mismo título — igual que
# HISTORICAL_SAMPLE_SIZE en src/lib/targetTimeServer.ts.
HISTORICAL_SAMPLE_SIZE = 40

# "Activas o recientes" — ventana de tareas archivadas que aún cuentan
# para el % de calidad del dato y el listado de pendientes. Igual que
# REGULARIZATION_RECENT_DAYS, duplicada en 3 archivos del legacy
# (target-time/end-date/task-validation Server.ts); aquí un solo helper
# porque las 3 conviven en este módulo — ver plan de sub-fase 3c-bulk.
REGULARIZATION_RECENT_DAYS = 60

# `ROLE_LABEL` vive en `apps.hierarchy.services` desde la Fase 28 (ver
# docs/AUDIT_LOG.md § 2026-08-20) — Tareas fue el primer consumidor
# (mensaje de notificación de comentarios de actividad, Fase 3f) y lo
# mantuvo como copia local hasta que el Centro de Configuración
# (`role-targets`/`role-compatibility`) se convirtió en un segundo
# consumidor real, mismo criterio ya aplicado a `ROLE_LEVEL` en la
# Fase 9b (ver `apps.projects.permissions`).


def _actor_role_name(actor) -> str:
    """Snapshot del rol del actor en el momento del evento — el invariante
    "1 rol por usuario" ya lo garantiza apps.hierarchy, no este helper."""
    group = actor.groups.first()
    return group.name if group else ""


def get_activity_reason_label_map() -> dict[str, str]:
    """`key -> label` para TODOS los motivos (activos e inactivos) —
    réplica exacta de `getActivityReasonLabelMap`
    (`src/lib/activityReasons.ts`). Usado por `GET /api/dashboard` para
    etiquetar el feed de actividad reciente del área."""
    return dict(ActivityReason.objects.values_list("key", "label"))


def _active_or_recent_scope() -> Q:
    recent_since = timezone.now() - timedelta(days=REGULARIZATION_RECENT_DAYS)
    return Q(archived_month__isnull=True) | Q(archived_at__gte=recent_since)


def _data_quality_from_counts(*, validated_count: int, total_count: int) -> dict:
    validated_pct = round_half_up(validated_count / total_count * 100) if total_count > 0 else 100
    return {
        "validated_count": validated_count,
        "pending_count": total_count - validated_count,
        "total_count": total_count,
        "validated_pct": validated_pct,
        "pending_pct": 100 - validated_pct,
    }


class TaskService:
    @staticmethod
    def create_task(*, actor, **fields) -> Task:
        status = fields.get("status", Task.Status.PENDIENTE)
        task = Task.objects.create(
            created_by=actor,
            progress=100 if status == Task.Status.COMPLETADA else 0,
            completed_at=timezone.now() if status == Task.Status.COMPLETADA else None,
            **fields,
        )
        return task

    @staticmethod
    def update_task(*, actor, task: Task, fields: dict, ip_address: str | None = None) -> Task:
        is_self = task.assigned_to_id == actor.id
        forbidden = SELF_ONLY_FIELDS & fields.keys()
        if forbidden and not is_self:
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["Solo el responsable de la tarea puede editar ese campo."]}
            )

        if "status" in fields:
            new_status = fields["status"]
            if new_status == Task.Status.COMPLETADA:
                fields["progress"] = 100
                fields["completed_at"] = timezone.now()
            elif new_status == Task.Status.PENDIENTE:
                fields["progress"] = 0
                fields["completed_at"] = None
            else:
                fields["completed_at"] = None

        # Fase 3c (ver docs/AUDIT_LOG.md § 2026-08-07): si `end_date` cambia
        # de valor Y la Fecha Fin ya había sido decidida (Aprobada/
        # Modificada/Rechazada), esa edición ES la "nueva solicitud de
        # aprobación" — se reinicia a Pendiente y queda auditada. Si ya
        # estaba Pendiente, se actualiza sin auditar — mismo criterio que
        # `pendingResetTaskData`/`createEndDateProposalAuditLog` legacy.
        end_date_proposal = None
        if (
            "end_date" in fields
            and fields["end_date"] != task.end_date
            and task.end_date_approval_status != Task.EndDateApprovalStatus.PENDIENTE
        ):
            end_date_proposal = {"previous": task.end_date, "new": fields["end_date"]}
            fields["end_date_approval_status"] = Task.EndDateApprovalStatus.PENDIENTE
            fields["end_date_approved_at"] = None
            fields["end_date_approved_by"] = None

        with transaction.atomic():
            for field, value in fields.items():
                setattr(task, field, value)
            task.save()

            if end_date_proposal:
                EndDateAuditLog.objects.create(
                    task_id=task.id,
                    user=actor,
                    user_role=_actor_role_name(actor),
                    action=EndDateAuditLog.Action.PROPUESTA,
                    previous_value=end_date_proposal["previous"],
                    new_value=end_date_proposal["new"],
                    ip_address=ip_address,
                )
        return task

    @staticmethod
    def can_access(*, actor, task: Task) -> bool:
        """Ver/editar/comentar — equivalente a `canAccessTask` del Next.js
        legacy, salvo la visibilidad jerárquica vía `getVisibleRoles`
        (`apps.hierarchy` todavía no está conectado a las vistas de Django
        — decisión explícita, ver plan de Fase 3a): un gerente que hoy
        puede editar la tarea de un subordinado por jerarquía, en esta
        sub-fase no podrá hacerlo salvo que además tenga `usuarios.editar`
        — gap documentado, se amplía en una sub-fase posterior."""
        from apps.permissions.authorization import user_has_permission

        return (
            task.assigned_to_id == actor.id
            or task.created_by_id == actor.id
            or user_has_permission(actor, "usuarios.editar")
        )

    @staticmethod
    def can_delete(*, actor, task: Task) -> bool:
        """Eliminar — igual al `DELETE /api/tasks/[id]` legacy, que es MÁS
        ESTRECHO que `canAccessTask`: el responsable asignado NO puede
        borrar la tarea (solo verla/editarla), únicamente quien la creó o
        tiene `usuarios.editar`."""
        from apps.permissions.authorization import user_has_permission

        return task.created_by_id == actor.id or user_has_permission(actor, "usuarios.editar")


class CommentService:
    @staticmethod
    def list_and_mark_viewed(*, task: Task, user) -> list[Comment]:
        comments = list(task.comments.select_related("author").all())
        TaskCommentView.objects.update_or_create(task=task, user=user)
        return comments

    @staticmethod
    def create_comment(*, task: Task, author, text: str) -> Comment:
        """Cierra el gap documentado desde la Fase 35 (ver docs/AUDIT_LOG.md
        § 2026-08-28): los destinatarios ya NO salen de la jerarquía fija
        (`get_notification_target_groups`/`RoleNotificationTarget`) sino de
        `get_effective_notification_rules()["comment_targets"]`, editable
        vía `/settings/notification-rules/` — bajo la config DEFAULT (sin
        override guardado) el resultado es idéntico al anterior, porque
        `get_default_notification_rules()` ya replica esa misma jerarquía.
        `first_comment_role` (rol adicional notificado en el PRIMER
        comentario de la tarea, gap total hasta ahora — sin consumidor ni
        siquiera en el legacy TS original) se une al mismo conjunto de
        destinatarios, sin duplicar notificación si un usuario cae en
        ambos. `.exclude(id=author.id)`: salvaguarda NUEVA — con la
        jerarquía fija el autor nunca podía auto-notificarse (mapeo
        siempre "hacia arriba"), pero la config ahora es libremente
        editable por rol, así que un Administrador podría configurar un
        rol para notificarse a sí mismo; se preserva el invariante
        implícito que ya existía."""
        from apps.configuration.services import get_effective_notification_rules
        from apps.hierarchy.services import get_role_group
        from apps.notifications.services import notify_many

        is_first_comment = not task.comments.exists()
        comment = Comment.objects.create(task=task, author=author, text=text)

        role_group = get_role_group(author)
        role_name = role_group.name if role_group else None
        rules = get_effective_notification_rules()
        target_role_names = set(rules["comment_targets"].get(role_name, [])) if role_name else set()
        if is_first_comment and rules["first_comment_role"]:
            target_role_names.add(rules["first_comment_role"])

        if target_role_names:
            preview = text[:60] + ("…" if len(text) > 60 else "")
            recipients = User.objects.filter(groups__name__in=target_role_names).exclude(id=author.id).distinct()
            notify_many(
                users=recipients,
                message=f'{author.first_name} comentó en "{task.title}": {preview}',
                task_id=task.id,
                task_title=task.title,
            )
        return comment


class ActivityService:
    """Registro de horas — Fase 3b (ver docs/AUDIT_LOG.md § 2026-08-07).
    Replica el orden exacto de validaciones de
    `src/app/api/tasks/[id]/activities/route.ts` (POST). Sin
    `migrateFijaHistoryIfNeeded`: no aplica — los `Task` de Django son
    todos nuevos, no hay historial previo que conciliar."""

    @staticmethod
    def create_activity(
        *,
        actor,
        task: Task,
        reason: str,
        hours: int,
        minutes: int,
        description: str = "",
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> TaskActivity:
        reason_row = ActivityReason.objects.filter(key=reason).first()
        actor_role_names = set(actor.groups.values_list("name", flat=True))
        if (
            reason_row is None
            or not reason_row.is_active
            or not actor_role_names.intersection(reason_row.assigned_roles)
        ):
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["Motivo inválido o no disponible para tu rol."]}
            )

        duration = hours * 60 + minutes
        if duration <= 0:
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["La duración debe ser mayor a 0."]}
            )

        if task.type == Task.Type.FIJA and task.activities.count() >= FIJA_MAX_ACTIVITIES:
            raise drf_serializers.ValidationError({"non_field_errors": [FIJA_MAX_ACTIVITIES_MESSAGE]})

        # El validador de solapamiento solo aplica cuando se usa el formato
        # hora inicio/hora fin — igual criterio que el Next.js legacy.
        if start_time and end_time:
            if time_to_minutes(start_time) is None or time_to_minutes(end_time) is None:
                raise drf_serializers.ValidationError({"non_field_errors": ["Hora inválida."]})
            if time_to_minutes(end_time) <= time_to_minutes(start_time):
                raise drf_serializers.ValidationError(
                    {"non_field_errors": ["La hora fin debe ser posterior a la hora inicio."]}
                )
            conflict = ActivityService._find_overlap_message(
                actor, business_calendar_day(timezone.now()), start_time, end_time
            )
            if conflict:
                raise drf_serializers.ValidationError({"non_field_errors": [conflict]})

        activity = TaskActivity.objects.create(
            task=task,
            author=actor,
            reason=reason,
            duration=duration,
            description=description.strip(),
            start_time=start_time or None,
            end_time=end_time or None,
        )
        ActivityService._recalc_task_real_hours(task)
        return activity

    @staticmethod
    def _find_overlap_message(actor, day, start_time: str, end_time: str) -> str | None:
        """Busca, entre TODAS las actividades del actor ese día de negocio
        (cualquier tarea SEGUIMIENTO, nunca FIJA), una cuyo horario se
        solape con el nuevo — igual criterio que `findOverlappingActivity`
        de `src/lib/activityOverlap.ts`. `day` es el día de negocio contra
        el que se compara: "hoy" para el registro normal, el día
        retroactivo elegido para `create_retroactive_activity`."""
        start, end = business_day_real_range(day)
        candidates = TaskActivity.objects.filter(
            author=actor,
            created_at__gte=start,
            created_at__lte=end,
            start_time__isnull=False,
            end_time__isnull=False,
            task__type=Task.Type.SEGUIMIENTO,
        ).select_related("task")

        for candidate in candidates:
            if ranges_overlap(start_time, end_time, candidate.start_time, candidate.end_time):
                return (
                    f"Este horario se superpone con una actividad registrada de "
                    f"{candidate.start_time} a {candidate.end_time} en la tarea "
                    f'"{candidate.task.title}". Por favor ajusta el horario.'
                )
        return None

    @staticmethod
    def _recalc_task_real_hours(task: Task) -> None:
        total_minutes = task.activities.aggregate(total=Sum("duration"))["total"] or 0
        task.real_hours = round_half_up(total_minutes / 60, 2)
        task.save(update_fields=["real_hours"])

    @staticmethod
    def create_retroactive_activity(
        *,
        actor,
        task: Task,
        reason: str,
        hours: int,
        minutes: int,
        description: str,
        activity_date_raw: str,
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> TaskActivity:
        """Registro retroactivo — Fase 3f (ver docs/AUDIT_LOG.md §
        2026-08-07), réplica de `POST /activities/retroactive` legacy.
        Solo aplica a tareas SEGUIMIENTO. El solapamiento se simplifica a
        400 uniforme — mismo gap ya aceptado en 3b para el 409/400 de
        `create_activity`, no una regresión nueva."""
        from apps.configuration.services import get_effective_retroactive_window_days
        from apps.notifications.services import notify_many

        reason_row = ActivityReason.objects.filter(key=reason).first()
        actor_role_names = set(actor.groups.values_list("name", flat=True))
        if (
            reason_row is None
            or not reason_row.is_active
            or not actor_role_names.intersection(reason_row.assigned_roles)
        ):
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["Motivo inválido o no disponible para tu rol."]}
            )

        if not description.strip():
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["La descripción es obligatoria para un registro retroactivo."]}
            )

        duration = hours * 60 + minutes
        if duration <= 0:
            raise drf_serializers.ValidationError({"non_field_errors": ["La duración debe ser mayor a 0."]})

        parsed_date = parse_date_only(activity_date_raw)
        if parsed_date is None:
            raise drf_serializers.ValidationError({"non_field_errors": ["Fecha inválida."]})

        now = timezone.now()
        window_days = get_effective_retroactive_window_days(now)
        valid_dates = retroactive_valid_dates(business_calendar_day(now), window_days)
        if parsed_date not in valid_dates:
            raise drf_serializers.ValidationError(
                {
                    "non_field_errors": [
                        f"La fecha debe ser uno de los últimos {window_days} días laborables (no incluye "
                        "hoy), o el sábado/domingo inmediato anterior si aún está disponible"
                    ]
                }
            )

        if task.type != Task.Type.SEGUIMIENTO:
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["El registro retroactivo solo aplica a tareas de tipo Seguimiento."]}
            )

        if start_time and end_time:
            if time_to_minutes(start_time) is None or time_to_minutes(end_time) is None:
                raise drf_serializers.ValidationError({"non_field_errors": ["Hora inválida."]})
            if time_to_minutes(end_time) <= time_to_minutes(start_time):
                raise drf_serializers.ValidationError(
                    {"non_field_errors": ["La hora fin debe ser posterior a la hora inicio."]}
                )
            conflict = ActivityService._find_overlap_message(actor, parsed_date, start_time, end_time)
            if conflict:
                raise drf_serializers.ValidationError({"non_field_errors": [conflict]})

        # El `created_at` se fija DENTRO del rango horario real del día
        # retroactivo (no "ahora") — mismo truco que el legacy, para que
        # cualquier cálculo que agrupe por `created_at` atribuya estas
        # horas al día correcto sin necesitar cambios propios.
        backdated_created_at, _ = business_day_real_range(parsed_date)
        activity_date_dt = datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=dt_timezone.utc)

        activity = TaskActivity.objects.create(
            task=task, author=actor, reason=reason, duration=duration, description=description.strip(),
            is_retroactive=True, activity_date=activity_date_dt,
            start_time=start_time or None, end_time=end_time or None,
        )
        TaskActivity.objects.filter(pk=activity.pk).update(created_at=backdated_created_at)
        activity.created_at = backdated_created_at

        ActivityService._recalc_task_real_hours(task)

        from apps.configuration.services import get_effective_notification_rules

        retroactive_notify_roles = get_effective_notification_rules()["retroactive_notify_roles"]
        notify_targets = User.objects.filter(groups__name__in=retroactive_notify_roles).distinct()
        notify_many(
            users=notify_targets,
            message=(
                f"{actor.first_name} registró horas retroactivas del {parsed_date.day:02d}/"
                f'{parsed_date.month:02d}/{parsed_date.year} en la tarea "{task.title}"'
            ),
            task_id=task.id,
            task_title=task.title,
        )
        return activity

    @staticmethod
    def admin_edit_activity(*, admin, activity: TaskActivity, hours: int, minutes: int, comment: str) -> TaskActivity:
        """Edición de horas por un Administrador — Fase 3f, réplica de
        `PATCH /activities/{activityId}` legacy. La autorización
        (`ADMINISTRADOR` únicamente) vive en la vista, no aquí."""
        from apps.notifications.services import notify

        new_duration = hours * 60 + minutes
        if new_duration <= 0:
            raise drf_serializers.ValidationError({"non_field_errors": ["La duración debe ser mayor a 0."]})
        if not comment.strip():
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["El comentario de modificación es obligatorio."]}
            )

        task = activity.task
        old_duration = activity.duration
        trimmed_comment = comment.strip()
        modified_at = timezone.now()

        with transaction.atomic():
            activity.duration = new_duration
            activity.admin_comment = trimmed_comment
            activity.modified_by_admin = True
            activity.modified_at = modified_at
            activity.save(update_fields=["duration", "admin_comment", "modified_by_admin", "modified_at"])

            ActivityService._recalc_task_real_hours(task)

            ActivityAuditLog.objects.create(
                activity_id=activity.id,
                admin=admin,
                old_duration=old_duration,
                new_duration=new_duration,
                comment=trimmed_comment,
                modified_at=modified_at,
            )

            notify(
                user=task.assigned_to,
                message=f'El Administrador modificó una actividad en "{task.title}": {trimmed_comment}',
                task_id=task.id,
                task_title=task.title,
            )
        return activity

    @staticmethod
    def delete_activity(*, activity: TaskActivity) -> None:
        """Autorización (`activity.author == actor`) vive en la vista."""
        task = activity.task
        activity.delete()
        ActivityService._recalc_task_real_hours(task)


class ActivityCommentService:
    """Comentarios sobre un registro de horas — Fase 3f (ver
    docs/AUDIT_LOG.md § 2026-08-07)."""

    @staticmethod
    def list_comments(*, activity: TaskActivity) -> list[ActivityComment]:
        return list(activity.comments.select_related("author").order_by("created_at"))

    @staticmethod
    def create_comment(*, actor, activity: TaskActivity, task: Task, text: str) -> ActivityComment:
        """Notificación BIDIRECCIONAL: a diferencia de los comentarios de
        tarea (que solo notifican hacia arriba en la jerarquía), aquí se
        notifica a TODOS los que ya participaron en el hilo (autor de la
        actividad + cualquiera que haya comentado antes), sin importar su
        rol — excepto a quien acaba de comentar."""
        from apps.notifications.services import notify_many

        comment = ActivityComment.objects.create(activity=activity, author=actor, text=text)

        prior_commenter_ids = set(
            activity.comments.exclude(id=comment.id).values_list("author_id", flat=True).distinct()
        )
        participant_ids = {activity.author_id, *prior_commenter_ids}
        participant_ids.discard(actor.id)

        if participant_ids:
            role_group = actor.groups.first()
            role_label = ROLE_LABEL.get(role_group.name, role_group.name) if role_group else ""
            participants = User.objects.filter(id__in=participant_ids)
            notify_many(
                users=participants,
                message=f'{actor.first_name} ({role_label}) comentó en una actividad de "{task.title}"',
                task_id=task.id,
                task_title=task.title,
            )
        return comment


class TargetTimeService:
    """Validación de Tiempo Objetivo — Fase 3c (ver docs/AUDIT_LOG.md §
    2026-08-07). Nunca toca `real_hours` — igual que el legacy, comentado
    explícitamente en `targetTimeServer.ts`."""

    @staticmethod
    def can_validate(*, actor, task: Task) -> bool:
        """`usuarios.editar` es, en el estado actual sembrado, exactamente
        el mismo conjunto de roles que `CAN_VALIDATE_TARGET_TIME_ROLES`
        legacy (ADMINISTRADOR/JEFE_NACIONAL/COORDINADOR_NACIONAL) — ver
        plan de Fase 3c. Nunca el propio responsable, sin importar su rol."""
        from apps.permissions.authorization import user_has_permission

        return user_has_permission(actor, "usuarios.editar") and actor.id != task.assigned_to_id

    @staticmethod
    def get_info(*, actor, task: Task) -> dict:
        official_target = (
            task.target_time_validated if task.target_time_validated is not None else task.estimated_hours
        )
        deviation_hours = round_half_up(task.real_hours - official_target, 2)
        deviation_pct = round_half_up((deviation_hours / official_target) * 100) if official_target > 0 else None

        return {
            "estimated_hours": task.estimated_hours,
            "target_time_validated": task.target_time_validated,
            "target_time_validated_at": task.target_time_validated_at,
            "validated_by": task.target_time_validated_by,
            "is_validated": task.target_time_validated is not None,
            "official_target": official_target,
            "real_hours": task.real_hours,
            "deviation": {"hours": deviation_hours, "pct": deviation_pct},
            "can_validate": TargetTimeService.can_validate(actor=actor, task=task),
            "audit_history": list(
                TargetTimeAuditLog.objects.filter(task_id=task.id)
                .select_related("user")
                .order_by("-created_at")
            ),
            "historical_deviation": TargetTimeService._historical_deviation(task, official_target),
        }

    @staticmethod
    def _historical_deviation(task: Task, official_target: float) -> dict:
        """Promedio de `real_hours` de hasta 40 tareas `COMPLETADA` con el
        mismo título (case-insensitive), excluyendo la propia — igual
        criterio que `getHistoricalDeviationForTask`. Nunca sugiere
        reemplazar el objetivo automáticamente, solo informa."""
        no_data = {"available": False, "reason": "Sin historial suficiente de casos similares para comparar."}

        cases = list(
            Task.objects.filter(
                title__iexact=task.title.strip(), status=Task.Status.COMPLETADA, real_hours__gt=0
            )
            .exclude(id=task.id)
            .order_by("-completed_at")
            .values_list("real_hours", flat=True)[:HISTORICAL_SAMPLE_SIZE]
        )
        if not cases or official_target <= 0:
            return no_data

        avg = sum(cases) / len(cases)
        diff_pct = round_half_up(((avg - official_target) / official_target) * 100)
        if diff_pct > 15:
            recommendation = (
                f"El tiempo real promedio supera el objetivo en un {diff_pct}%. "
                "Se recomienda revisar el estándar del proceso."
            )
        elif diff_pct < -15:
            recommendation = (
                f"El tiempo real promedio está un {abs(diff_pct)}% por debajo del objetivo. "
                "Se recomienda revisar si el estándar quedó sobreestimado."
            )
        else:
            recommendation = f"El tiempo real promedio está alineado con el objetivo (diferencia de {diff_pct}%)."

        return {
            "available": True,
            "sample_size": len(cases),
            "avg_real_hours": round_half_up(avg, 2),
            "diff_pct": diff_pct,
            "recommendation": recommendation,
        }

    @staticmethod
    def apply_validation(
        *, actor, task: Task, new_value: float, reason: str, reason_detail: str | None,
        ip_address: str | None = None,
    ) -> Task:
        if not TargetTimeService.can_validate(actor=actor, task=task):
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["No tienes permiso para validar el Tiempo Objetivo de esta tarea."]}
            )

        with transaction.atomic():
            previous_value = task.target_time_validated
            task.target_time_validated = new_value
            task.target_time_validated_at = timezone.now()
            task.target_time_validated_by = actor
            task.save(
                update_fields=["target_time_validated", "target_time_validated_at", "target_time_validated_by"]
            )

            TargetTimeAuditLog.objects.create(
                task_id=task.id,
                user=actor,
                user_role=_actor_role_name(actor),
                previous_value=previous_value,
                new_value=new_value,
                reason=reason,
                reason_detail=reason_detail,
                ip_address=ip_address,
            )
        return task

    @staticmethod
    def data_quality(*, role: str | None = None) -> dict:
        """Indicador de calidad del dato — % de tareas activas/recientes
        con el Tiempo Objetivo ya validado, igual que
        `getTargetTimeDataQuality` legacy."""
        qs = Task.objects.filter(_active_or_recent_scope())
        if role:
            qs = qs.filter(assigned_to__groups__name=role)
        total_count = qs.count()
        validated_count = qs.filter(target_time_validated__isnull=False).count()
        return _data_quality_from_counts(validated_count=validated_count, total_count=total_count)

    @staticmethod
    def bulk_validate(
        *, actor, task_ids: list[int], new_value: float, reason: str, reason_detail: str | None,
        ip_address: str | None = None,
    ) -> dict:
        """Reutiliza `apply_validation` por tarea — mismo criterio que
        `applyTargetTimeValidation` legacy, reusado también por el bulk.
        La autorización general (`CanRegularize`) ya se verificó a nivel
        de vista; IDs inexistentes se ignoran en silencio, igual que el
        legacy — ver plan de sub-fase 3c-bulk."""
        rounded_value = round_half_up(new_value, 2)
        detail = reason_detail.strip() if isinstance(reason_detail, str) and reason_detail.strip() else None

        tasks = list(Task.objects.filter(id__in=task_ids))
        skipped_self_assigned = [t.id for t in tasks if t.assigned_to_id == actor.id]
        eligible = [t for t in tasks if t.assigned_to_id != actor.id]

        for task in eligible:
            TargetTimeService.apply_validation(
                actor=actor, task=task, new_value=rounded_value, reason=reason,
                reason_detail=detail, ip_address=ip_address,
            )

        return {"updated_count": len(eligible), "skipped_self_assigned": skipped_self_assigned}


class EndDateService:
    """Validación de Fecha Fin por líderes — Fase 3c. Mismo criterio de
    autorización que `TargetTimeService` (ver `can_validate`)."""

    @staticmethod
    def can_validate(*, actor, task: Task) -> bool:
        from apps.permissions.authorization import user_has_permission

        return user_has_permission(actor, "usuarios.editar") and actor.id != task.assigned_to_id

    @staticmethod
    def get_info(*, actor, task: Task) -> dict:
        return {
            "end_date": task.end_date,
            "end_date_approval_status": task.end_date_approval_status,
            "end_date_approved_at": task.end_date_approved_at,
            "approved_by": task.end_date_approved_by,
            "can_validate": EndDateService.can_validate(actor=actor, task=task),
            "audit_history": list(
                EndDateAuditLog.objects.filter(task_id=task.id).select_related("user").order_by("-created_at")
            ),
        }

    @staticmethod
    def apply_action(
        *, actor, task: Task, action: str, new_end_date, observaciones: str | None,
        ip_address: str | None = None,
    ) -> Task:
        from apps.notifications.services import notify

        if not EndDateService.can_validate(actor=actor, task=task):
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["No tienes permiso para decidir la Fecha Fin de esta tarea."]}
            )

        result_status = {
            "APROBAR": Task.EndDateApprovalStatus.APROBADA,
            "MODIFICAR": Task.EndDateApprovalStatus.MODIFICADA,
            "RECHAZAR": Task.EndDateApprovalStatus.RECHAZADA,
        }[action]
        previous_end_date = task.end_date
        new_end_date_value = new_end_date if action == "MODIFICAR" else task.end_date

        with transaction.atomic():
            task.end_date = new_end_date_value
            task.end_date_approval_status = result_status
            task.end_date_approved_at = timezone.now()
            task.end_date_approved_by = actor
            task.save(
                update_fields=[
                    "end_date", "end_date_approval_status", "end_date_approved_at", "end_date_approved_by",
                ]
            )

            EndDateAuditLog.objects.create(
                task_id=task.id,
                user=actor,
                user_role=_actor_role_name(actor),
                action=result_status,
                previous_value=previous_end_date,
                new_value=new_end_date_value,
                observaciones=observaciones,
                ip_address=ip_address,
            )

            # Cierra el gap documentado en la Fase 3c: notifica al
            # colaborador cuando MODIFICADA/RECHAZADA (nunca en APROBADA)
            # — mensaje recuperado 1:1 de `notifyEndDateChange` legacy.
            if result_status in (Task.EndDateApprovalStatus.MODIFICADA, Task.EndDateApprovalStatus.RECHAZADA):
                fmt = lambda d: f"{d.day:02d}/{d.month:02d}/{d.year}"  # noqa: E731
                obs_suffix = f" Observación: {observaciones}" if observaciones else ""
                if result_status == Task.EndDateApprovalStatus.MODIFICADA:
                    message = (
                        f'Tu fecha de finalización para la actividad "{task.title}" fue ajustada por tu jefe '
                        f"de {fmt(previous_end_date)} a {fmt(new_end_date_value)}.{obs_suffix}"
                    )
                else:
                    message = (
                        f"Tu jefe rechazó la fecha de finalización propuesta ({fmt(previous_end_date)}) para "
                        f'la actividad "{task.title}". Debes proponer una nueva fecha.{obs_suffix}'
                    )
                notify(
                    user=task.assigned_to, message=message, task_id=task.id, task_title=task.title,
                )
        return task

    @staticmethod
    def data_quality(*, role: str | None = None) -> dict:
        """Igual que `getEndDateDataQuality` legacy: `validated_count` es
        en realidad "no pendiente" — incluye APROBADA, MODIFICADA Y
        TAMBIÉN RECHAZADA (réplica deliberada de la discrepancia entre el
        comentario y la implementación real del legacy — se porta la
        implementación, no el comentario)."""
        qs = Task.objects.filter(_active_or_recent_scope())
        if role:
            qs = qs.filter(assigned_to__groups__name=role)
        total_count = qs.count()
        pending_count = qs.filter(end_date_approval_status=Task.EndDateApprovalStatus.PENDIENTE).count()
        return _data_quality_from_counts(validated_count=total_count - pending_count, total_count=total_count)

    @staticmethod
    def bulk_approve(
        *, actor, items: list[dict], observaciones: str | None, ip_address: str | None = None,
    ) -> dict:
        """Reutiliza `apply_action` por tarea — mismo criterio que
        `applyEndDateAction` legacy, reusado también por el bulk. `items`
        ya viene parseado por el serializer: `[{"task_id": int,
        "new_end_date": datetime | None}, ...]`. Reenviar la fecha vigente
        sin cambiarla se trata como aprobación simple, igual que el
        legacy — ver plan de sub-fase 3c-bulk."""
        detail = observaciones.strip() if isinstance(observaciones, str) and observaciones.strip() else None
        task_ids = [item["task_id"] for item in items]
        tasks_by_id = {t.id: t for t in Task.objects.filter(id__in=task_ids)}

        updated_count = 0
        skipped_self_assigned: list[int] = []
        skipped_invalid_date: list[int] = []

        for item in items:
            task = tasks_by_id.get(item["task_id"])
            if task is None:
                continue
            if task.assigned_to_id == actor.id:
                skipped_self_assigned.append(task.id)
                continue

            new_end_date = item.get("new_end_date")
            action = "APROBAR"
            new_end_date_value = None
            if new_end_date is not None:
                if new_end_date < task.start_date:
                    skipped_invalid_date.append(task.id)
                    continue
                if new_end_date != task.end_date:
                    action = "MODIFICAR"
                    new_end_date_value = new_end_date

            EndDateService.apply_action(
                actor=actor, task=task, action=action, new_end_date=new_end_date_value,
                observaciones=detail, ip_address=ip_address,
            )
            updated_count += 1

        return {
            "updated_count": updated_count,
            "skipped_self_assigned": skipped_self_assigned,
            "skipped_invalid_date": skipped_invalid_date,
        }


class TaskValidationService:
    """Listado combinado de tareas pendientes de regularizar — Tiempo
    Objetivo O Fecha Fin (o ambas). Reemplaza los 2 endpoints separados
    del legacy en una sola pantalla, igual que
    `getPendingTaskValidations` — ver plan de sub-fase 3c-bulk."""

    @staticmethod
    def list_pending(
        *, user_id: int | None = None, role: str | None = None, task_type: str | None = None,
    ) -> QuerySet[Task]:
        from django.contrib.auth.models import Group

        # Valores inválidos se ignoran (no filtran), igual que el legacy
        # (`ALL_ROLES.includes`/chequeo de enum) — nunca un 400 por esto.
        if role and not Group.objects.filter(name=role).exists():
            role = None
        if task_type not in (Task.Type.FIJA, Task.Type.SEGUIMIENTO):
            task_type = None

        qs = Task.objects.filter(_active_or_recent_scope()).filter(
            Q(target_time_validated__isnull=True)
            | Q(end_date_approval_status=Task.EndDateApprovalStatus.PENDIENTE)
        )
        if user_id:
            qs = qs.filter(assigned_to_id=user_id)
        if task_type:
            qs = qs.filter(type=task_type)
        if role:
            qs = qs.filter(assigned_to__groups__name=role)

        return qs.select_related("assigned_to").order_by("-created_at")[:300]


class MonthClosureService:
    """Motor de Cierre Inteligente — Fase 3d (ver docs/AUDIT_LOG.md §
    2026-08-07). El archivado/duplicación de recurrentes SIEMPRE ancla al
    fin de mes calendario natural; `cutoff_date` solo acota los 3 campos
    informativos (`calendar_days_considered`/`working_days_considered`/
    `working_hours_considered`, congelados al cerrar), nunca qué tareas se
    archivan — mismo criterio que el legacy."""

    @staticmethod
    def _candidate_tasks_queryset(month_end: datetime):
        return Task.objects.filter(archived_month__isnull=True, end_date__lt=month_end).filter(
            Q(type=Task.Type.FIJA) | Q(type=Task.Type.SEGUIMIENTO, status=Task.Status.COMPLETADA)
        )

    @staticmethod
    def _continued_active_count(month_end: datetime) -> int:
        return Task.objects.filter(
            archived_month__isnull=True, end_date__lt=month_end, type=Task.Type.SEGUIMIENTO,
            status__in=[Task.Status.PENDIENTE, Task.Status.EN_PROGRESO],
        ).count()

    @staticmethod
    def preview(*, year: int, month: int, cutoff_date_raw: str | None, now: datetime) -> dict:
        cutoff_date = resolve_cutoff_date(year, month, cutoff_date_raw, now)
        existing = MonthClosure.objects.filter(month=month, year=year).exists()
        month_end = next_month_start(year, month)

        statuses = list(MonthClosureService._candidate_tasks_queryset(month_end).values_list("status", flat=True))
        continued_active = MonthClosureService._continued_active_count(month_end)
        business = business_base_for_range(period_start(year, month).date(), cutoff_date.date())

        return {
            "year": year,
            "month": month,
            "already_closed": existing,
            "total": len(statuses),
            "completed": statuses.count(Task.Status.COMPLETADA),
            "pending": statuses.count(Task.Status.PENDIENTE),
            "in_progress": statuses.count(Task.Status.EN_PROGRESO),
            "continued_active": continued_active,
            "cutoff_date": cutoff_date,
            "closure_type": determine_closure_type(year, month, cutoff_date, now),
            "calendar_days_total": days_in_month(year, month),
            "calendar_days_considered": cutoff_date.day,
            "working_days_considered": business["business_days"],
            "working_hours_considered": business["base_hours"],
        }

    @staticmethod
    def execute(*, actor, year: int, month: int, cutoff_date_raw: str | None, now: datetime) -> dict:
        preview = MonthClosureService.preview(year=year, month=month, cutoff_date_raw=cutoff_date_raw, now=now)
        if preview["already_closed"]:
            raise drf_serializers.ValidationError({"non_field_errors": ["Este mes ya fue cerrado"]})

        cutoff_date = preview["cutoff_date"]
        closure_type = preview["closure_type"]
        month_end = next_month_start(year, month)
        next_year, next_month = next_year_month(year, month)

        candidate_tasks = list(MonthClosureService._candidate_tasks_queryset(month_end))
        continued_active = MonthClosureService._continued_active_count(month_end)

        total = len(candidate_tasks)
        completed = sum(1 for t in candidate_tasks if t.status == Task.Status.COMPLETADA)
        pending = sum(1 for t in candidate_tasks if t.status == Task.Status.PENDIENTE)
        in_progress = sum(1 for t in candidate_tasks if t.status == Task.Status.EN_PROGRESO)

        duplicates = [
            Task(
                title=t.title, description=t.description, status=Task.Status.PENDIENTE,
                priority=t.priority, frequency=t.frequency, type=t.type,
                start_date=shift_to_next_month(t.start_date, next_year, next_month),
                end_date=shift_to_next_month(t.end_date, next_year, next_month),
                estimated_hours=t.estimated_hours, real_hours=0, progress=0,
                assigned_to_id=t.assigned_to_id, created_by_id=t.created_by_id, color=t.color,
            )
            for t in candidate_tasks
            if t.frequency in RECURRING_FREQUENCIES
        ]

        archived_month_key = f"{year}-{month:02d}"
        task_ids = [t.id for t in candidate_tasks]

        with transaction.atomic():
            MonthClosure.objects.create(
                month=month, year=year, closed_by=actor, cutoff_date=cutoff_date, closure_type=closure_type,
                calendar_days_total=preview["calendar_days_total"],
                calendar_days_considered=preview["calendar_days_considered"],
                working_days_considered=preview["working_days_considered"],
                working_hours_considered=preview["working_hours_considered"],
                total_tasks=total, completed_tasks=completed,
                summary={
                    "total": total, "completed": completed, "pending": pending, "inProgress": in_progress,
                    "duplicated": len(duplicates), "continuedActive": continued_active,
                },
            )
            Task.objects.filter(id__in=task_ids).update(archived_month=archived_month_key, archived_at=timezone.now())
            if duplicates:
                Task.objects.bulk_create(duplicates)

        return {
            "archived_count": total,
            "duplicated_count": len(duplicates),
            "continued_active_count": continued_active,
            "month": month,
            "year": year,
            "next_month": next_month,
            "next_year": next_year,
            "cutoff_date": cutoff_date,
            "closure_type": closure_type,
            "calendar_days_total": preview["calendar_days_total"],
            "calendar_days_considered": preview["calendar_days_considered"],
            "working_days_considered": preview["working_days_considered"],
            "working_hours_considered": preview["working_hours_considered"],
        }

    @staticmethod
    def correct_archived_task(
        *, actor, task: Task, real_hours: float | None = None, status: str | None = None,
    ) -> Task:
        if not task.archived_month:
            raise drf_serializers.ValidationError(
                {"non_field_errors": ["Solo se pueden corregir tareas archivadas del repositorio"]}
            )
        if real_hours is None and status is None:
            raise drf_serializers.ValidationError({"non_field_errors": ["Nada que corregir"]})

        corrections: list[dict] = []
        fields: dict = {}
        now_iso = timezone.now().isoformat()

        if real_hours is not None:
            new_real_hours = round_half_up(real_hours, 2)
            if new_real_hours != task.real_hours:
                corrections.append(
                    {
                        "taskId": task.id, "field": "realHours", "oldValue": task.real_hours,
                        "newValue": new_real_hours, "correctedBy": actor.id, "correctedAt": now_iso,
                    }
                )
                fields["real_hours"] = new_real_hours

        if status is not None and status != task.status:
            corrections.append(
                {
                    "taskId": task.id, "field": "status", "oldValue": task.status,
                    "newValue": status, "correctedBy": actor.id, "correctedAt": now_iso,
                }
            )
            fields["status"] = status
            if status == Task.Status.COMPLETADA:
                fields["progress"] = 100
                fields["completed_at"] = task.completed_at or timezone.now()
            elif status == Task.Status.PENDIENTE:
                fields["progress"] = 0
                fields["completed_at"] = None
            elif status == Task.Status.EN_PROGRESO:
                fields["completed_at"] = None

        if not corrections:
            raise drf_serializers.ValidationError({"non_field_errors": ["No hay cambios para guardar"]})

        fields["corrected"] = True

        with transaction.atomic():
            for field, value in fields.items():
                setattr(task, field, value)
            task.save()

            closure_year, closure_month = task.archived_month.split("-")
            closure = MonthClosure.objects.filter(year=int(closure_year), month=int(closure_month)).first()
            if closure is not None:
                existing = closure.corrections if isinstance(closure.corrections, list) else []
                closure.corrections = existing + corrections
                closure.save(update_fields=["corrections"])
            else:
                logger.warning(
                    "MonthClosure no encontrado para archived_month=%s al corregir Task %s",
                    task.archived_month, task.id,
                )

        return task

    @staticmethod
    def list_repository_months(*, actor) -> list[dict]:
        """Gap de visibilidad (mismo patrón ya aceptado en 3a): sin
        `apps.hierarchy` conectado a las vistas de Django, se acota a las
        propias tareas archivadas del actor — nunca más permisivo que el
        legacy, solo más estrecho."""
        archived_tasks = Task.objects.filter(assigned_to=actor, archived_month__isnull=False).values(
            "archived_month", "status", "real_hours"
        )
        aggregates: dict[str, dict] = {}
        for row in archived_tasks:
            bucket = aggregates.setdefault(
                row["archived_month"], {"total_tasks": 0, "completed_tasks": 0, "total_hours": 0.0}
            )
            bucket["total_tasks"] += 1
            if row["status"] == Task.Status.COMPLETADA:
                bucket["completed_tasks"] += 1
            bucket["total_hours"] += row["real_hours"]

        result = []
        for closure in MonthClosure.objects.order_by("-year", "-month"):
            bucket = aggregates.get(f"{closure.year}-{closure.month:02d}")
            if bucket is None:
                continue
            result.append(
                {
                    "year": closure.year, "month": closure.month,
                    "total_tasks": bucket["total_tasks"], "completed_tasks": bucket["completed_tasks"],
                    "total_hours": round_half_up(bucket["total_hours"], 2),
                }
            )
        return result

    @staticmethod
    def list_repository_tasks(*, actor, year: int, month: int) -> QuerySet[Task] | None:
        if not MonthClosure.objects.filter(year=year, month=month).exists():
            return None
        archived_month_key = f"{year}-{month:02d}"
        return (
            Task.objects.filter(archived_month=archived_month_key, assigned_to=actor)
            .select_related("assigned_to", "created_by")
            .order_by("assigned_to__first_name", "title")
        )


class TaskImportService:
    """Importador masivo de Tareas por Excel — Fase 3e (ver
    docs/AUDIT_LOG.md § 2026-08-07). Réplica 1:1 de
    `src/app/api/tasks/import/route.ts`: cada fila es independiente (sin
    transacción global), SOLO crea tareas, nunca actualiza. Sin gate de
    rol — igual que el legacy."""

    @staticmethod
    def import_rows(*, actor, rows: list[tuple]) -> dict:
        imported = 0
        errors: list[dict] = []

        for index, row in enumerate(rows):
            row_num = index + 2
            padded = list(row) + [None] * (9 - len(row))
            (
                title, description, priority, frequency,
                start_raw, end_raw, hours_raw, email_raw, type_raw,
            ) = padded[:9]

            type_norm = str(type_raw or "").strip().upper()
            task_type = type_norm if type_norm in VALID_TYPES else "FIJA"

            if not (title and str(title).strip()):
                errors.append({"row": row_num, "error": "Título requerido"})
                continue
            if priority not in VALID_PRIORITIES:
                errors.append(
                    {"row": row_num, "error": f'Prioridad inválida: "{priority}". Use ALTA, MEDIA o BAJA'}
                )
                continue
            if frequency not in VALID_FREQUENCIES:
                errors.append(
                    {
                        "row": row_num,
                        "error": (
                            f'Frecuencia inválida: "{frequency}". '
                            "Use MENSUAL, SEMANAL, DIARIA, QUINCENAL o PUNTUAL"
                        ),
                    }
                )
                continue

            if start_raw is None or str(start_raw).strip() == "":
                errors.append({"row": row_num, "error": "la fecha de inicio es obligatoria"})
                continue
            start_date = parse_date(start_raw)
            if start_date is None:
                errors.append({"row": row_num, "error": "formato de fecha inválido, usar YYYY-MM-DD"})
                continue

            if end_raw is None or str(end_raw).strip() == "":
                errors.append({"row": row_num, "error": "la fecha de fin es obligatoria"})
                continue
            end_date = parse_date(end_raw)
            if end_date is None:
                errors.append({"row": row_num, "error": "formato de fecha inválido, usar YYYY-MM-DD"})
                continue

            try:
                estimated_hours = float(str(hours_raw))
            except (TypeError, ValueError):
                errors.append({"row": row_num, "error": "Tiempo objetivo inválido"})
                continue

            assigned_to = actor
            email = str(email_raw).strip() if email_raw else ""
            if email:
                user = User.objects.filter(email=email).first()
                if user is None:
                    errors.append({"row": row_num, "error": f'Usuario no encontrado: "{email_raw}"'})
                    continue
                assigned_to = user

            try:
                Task.objects.create(
                    title=str(title).strip(),
                    description=str(description).strip() if description else "",
                    priority=priority,
                    frequency=frequency,
                    type=task_type,
                    start_date=datetime(start_date.year, start_date.month, start_date.day, tzinfo=dt_timezone.utc),
                    end_date=datetime(end_date.year, end_date.month, end_date.day, tzinfo=dt_timezone.utc),
                    estimated_hours=estimated_hours,
                    assigned_to=assigned_to,
                    created_by=actor,
                )
                imported += 1
            except Exception:
                logger.exception("No se pudo crear la tarea importada de la fila %s", row_num)
                errors.append({"row": row_num, "error": "Error al crear la tarea"})

        return {"imported": imported, "errors": errors}
