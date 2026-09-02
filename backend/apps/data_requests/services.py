"""Orquestación de Solicitudes LOPD — Fase 12 (ver docs/AUDIT_LOG.md §
2026-08-19). Réplica exacta de los handlers `POST /api/data-requests`,
`PATCH /api/data-requests/[id]` y `GET /api/data-requests/my-data`."""

from django.utils import timezone

from apps.configuration.models import LeaveRecord, SpecialStatus
from apps.core.audit import record_audit_event
from apps.ideas.models import IdeaVote, ImprovementIdea
from apps.meetings.models import Meeting, MeetingInvitee
from apps.notifications.services import notify_many
from apps.tasks.models import Comment, Task, TaskActivity
from apps.users.models import User

from .models import DataSubjectRequest

MODULE = "solicitudes_lopd"

TYPE_LABEL = {
    DataSubjectRequest.Type.ACCESO: "acceso a mis datos",
    DataSubjectRequest.Type.RECTIFICACION: "rectificación de datos",
    DataSubjectRequest.Type.ELIMINACION: "eliminación de cuenta",
}


def create_data_request(
    *, user, type: str, description: str | None, context: dict | None = None
) -> DataSubjectRequest:
    """Réplica exacta del handler `POST /api/data-requests`. El acceso
    directo se resuelve al instante desde `export_my_data`; solo
    rectificación y eliminación requieren gestión manual del
    Administrador (y por eso notifican)."""
    data_request = DataSubjectRequest.objects.create(user=user, type=type, description=description)
    if type != DataSubjectRequest.Type.ACCESO:
        admins = User.objects.filter(groups__name="ADMINISTRADOR").distinct()
        notify_many(users=admins, message=f"{user.first_name} solicitó {TYPE_LABEL[type]}")
    # Hallazgo de la auditoría de datos personales (ver docs/AUDIT_LOG.md §
    # 2026-09-02): Solicitudes LOPD era el único flujo de datos personales
    # de todo el sistema que no dejaba rastro en el AuditLog central —
    # solo quedaba en los propios campos de DataSubjectRequest.
    record_audit_event(
        actor=user,
        action="data_request.created",
        target=data_request,
        module=MODULE,
        new_values={"type": type, "description": description},
        context=context,
    )
    return data_request


def resolve_data_request(
    *, data_request: DataSubjectRequest, status: str, resolver, context: dict | None = None
) -> DataSubjectRequest:
    """Réplica exacta del handler `PATCH /api/data-requests/[id]`: si
    el nuevo estado es RESUELTA, setea `resolved_by`/`resolved_at`; si
    no, los limpia (aunque ya estuvieran resueltos antes — réplica
    fiel, no condicional)."""
    previous_status = data_request.status
    resolved = status == DataSubjectRequest.Status.RESUELTA
    data_request.status = status
    data_request.resolved_by = resolver if resolved else None
    data_request.resolved_at = timezone.now() if resolved else None
    data_request.save()
    record_audit_event(
        actor=resolver,
        action="data_request.resolved",
        target=data_request,
        module=MODULE,
        previous_values={"status": previous_status},
        new_values={"status": status},
        context=context,
    )
    return data_request


def export_my_data(*, user, context: dict | None = None) -> dict:
    """Réplica exacta del handler `GET /api/data-requests/my-data`:
    junta todos los datos operativos del titular ya portados a Django
    (Tareas/Actividades/Comentarios/Reuniones/Ideas/Votos/solicitudes
    previas) y registra la exportación como una solicitud ACCESO ya
    resuelta (trazabilidad, no requiere gestión manual).

    Gap documentado: el `user` select del TS también incluye `theme`/
    `viewPreferences`/`badges`/`dataConsentAccepted`/
    `dataConsentAcceptedAt` — ninguno de esos campos existe todavía en
    el modelo `User` de Django (gaps ya documentados en fases previas:
    Fase 6b para theme/viewPreferences, Fase 11 para badges; consent
    queda fuera de alcance de esta fase, ver docstring de `models.py`).
    Se omiten de la exportación en vez de fabricar valores falsos.

    `permisos_y_ausencias`/`estado_especial` (`LeaveRecord`/
    `SpecialStatus`) — hallazgo de la auditoría de datos personales (ver
    docs/AUDIT_LOG.md § 2026-09-02, "Exportación de 'mis datos' excluía
    permisos médicos y estado especial del propio titular"): era la
    única categoría de dato que el titular no podía consultar sobre sí
    mismo pese a poder solicitarla como cualquier otra vía este mismo
    endpoint. La restricción real (solo Administrador puede crear/listar/
    eliminar estos registros, ver `apps/configuration/views.py`) sigue
    intacta — ver `user_has_permission`/gate de rol en esas vistas; acá
    solo se agrega la lectura del propio registro para el propio
    titular, con el mismo criterio ya usado por `redact_sensitive_
    workload_detail` (el propio titular siempre ve su detalle sin
    redactar)."""
    tasks = list(
        Task.objects.filter(assigned_to=user).values(
            "id",
            "title",
            "description",
            "status",
            "priority",
            "frequency",
            "type",
            "start_date",
            "end_date",
            "estimated_hours",
            "real_hours",
            "progress",
            "completed_at",
            "created_at",
        )
    )
    activities = list(
        TaskActivity.objects.filter(author=user).values(
            "id",
            "task_id",
            "reason",
            "start_time",
            "end_time",
            "duration",
            "description",
            "created_at",
        )
    )
    comments = list(
        Comment.objects.filter(author=user).values("id", "task_id", "text", "created_at")
    )
    meetings_hosted = list(
        Meeting.objects.filter(host=user).values(
            "id", "title", "meeting_date", "duration", "status"
        )
    )
    meetings_invited = list(
        MeetingInvitee.objects.filter(user=user)
        .select_related("meeting")
        .values("attended", "meeting_id", "meeting__title", "meeting__meeting_date")
    )
    ideas = list(
        ImprovementIdea.objects.filter(author=user).values(
            "id", "title", "description", "impact", "status", "progress", "created_at"
        )
    )
    votes = list(IdeaVote.objects.filter(user=user).values("idea_id", "created_at"))
    prior_requests = list(
        DataSubjectRequest.objects.filter(user=user).values(
            "id", "type", "status", "description", "created_at", "resolved_at"
        )
    )
    leave_records = list(
        LeaveRecord.objects.filter(user=user).values(
            "id", "type", "date", "is_full_day", "duration_minutes", "observation", "created_at"
        )
    )
    special_statuses = list(
        SpecialStatus.objects.filter(user=user).values(
            "id",
            "type",
            "start_date",
            "end_date",
            "is_active",
            "daily_hours",
            "limit_low",
            "limit_base",
            "limit_high",
            "limit_overload",
            "created_at",
        )
    )

    payload = {
        "generado_el": timezone.now().isoformat(),
        "usuario": {
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "email": user.email,
            "roles": list(user.groups.values_list("name", flat=True)),
            "last_login": user.last_login,
            "created_at": user.created_at,
        },
        "tareas": tasks,
        "actividades": activities,
        "comentarios": comments,
        "reuniones_organizadas": meetings_hosted,
        "reuniones_invitado": meetings_invited,
        "ideas_propuestas": ideas,
        "votos_en_ideas": votes,
        "solicitudes_previas": prior_requests,
        "permisos_y_ausencias": leave_records,
        "estado_especial": special_statuses,
    }

    traceability_record = DataSubjectRequest.objects.create(
        user=user,
        type=DataSubjectRequest.Type.ACCESO,
        status=DataSubjectRequest.Status.RESUELTA,
        resolved_at=timezone.now(),
    )
    record_audit_event(
        actor=user,
        action="data_request.exported",
        target=traceability_record,
        module=MODULE,
        context=context,
    )

    return payload
