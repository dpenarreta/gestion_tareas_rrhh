import base64
from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone

from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.configuration.services import get_effective_desk_note_max_replies
from apps.projects.models import Project
from apps.recovery.services import RecoveryError
from apps.tasks.business_time import business_calendar_day, business_day_real_range
from apps.tasks.models import Task
from apps.users.models import User

from .models import DeskAuditAction, DeskAuditLog, DeskNote, PersonalReminder
from .permissions import (
    CanAccessDeskNote,
    CanUseDeskNotes,
    IsDeskNoteRecipient,
    IsReminderOwner,
    can_use_desk_notes,
    role_name,
)
from .serializers import (
    ConvertNoteToReminderSerializer,
    ConvertReminderToTaskSerializer,
    DeskAuditLogSerializer,
    DeskNoteActionSerializer,
    DeskNoteCreateSerializer,
    DeskNoteRecipientSerializer,
    DeskNoteReplySerializer,
    DeskNoteSerializer,
    PersonalReminderCreateSerializer,
    PersonalReminderSerializer,
    PersonalReminderUpdateSerializer,
    ReminderDueAtSerializer,
    ReminderReopenSerializer,
    ReplyCreateSerializer,
)
from .services import (
    DeskNoteReplyService,
    DeskNoteService,
    PersonalReminderService,
    log_desk_audit,
    notify_due_reminders,
    purge_expired_archived_notes,
)


class DeskNoteViewSet(viewsets.ModelViewSet):
    """Fases 7a/7d/7e/14 de la migración de stack (ver docs/AUDIT_LOG.md
    § 2026-08-17/2026-08-20) — Escritorio Digital: Notas, CRUD core +
    adjuntos + `convert-to-reminder` + `DELETE` (Centro de
    Recuperación, Fase 14). **Sin cutover de `route.ts` todavía** —
    Next.js sigue sirviendo `/api/desk-notes` desde Postgres/Prisma."""

    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    serializer_class = DeskNoteSerializer
    queryset = DeskNote.objects.select_related("sender", "recipient")

    def get_permissions(self):
        if self.action == "partial_update":
            return [IsDeskNoteRecipient()]
        if self.action in ("retrieve", "history", "replies"):
            return [CanAccessDeskNote()]
        if self.action == "unread_count":
            # Réplica exacta de `GET /desk-notes/unread-count`: a
            # diferencia del resto del módulo, un Administrador no
            # recibe 403 acá — el badge del sidebar simplemente
            # muestra 0 (ver el cuerpo de la acción más abajo).
            return [IsAuthenticated()]
        return [CanUseDeskNotes()]

    def get_queryset(self):
        qs = self.queryset.filter(deleted_at__isnull=True)
        if self.action != "list":
            return qs
        user = self.request.user
        view = self.request.query_params.get("view", "desk")
        if view == "sent":
            return qs.filter(sender=user)
        if view == "archive":
            return qs.filter(recipient=user, archived=True)
        return qs.filter(recipient=user, archived=False)

    def list(self, request, *args, **kwargs):
        # Barrido perezoso de la retención de archivo — Fase 14 (ver
        # docs/AUDIT_LOG.md § 2026-08-20), réplica del trigger que el TS
        # tenía en este mismo endpoint antes del cutover de la Fase 7g.
        purge_expired_archived_notes()
        notes = self.get_queryset().order_by("-pinned", "-created_at")
        limit_param = request.query_params.get("limit")
        if limit_param:
            try:
                limit = max(1, min(100, int(limit_param)))
                notes = notes[:limit]
            except ValueError:
                pass
        return Response(DeskNoteSerializer(notes, many=True, context={"request": request}).data)

    def create(self, request, *args, **kwargs):
        serializer = DeskNoteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = DeskNoteService.create_note(actor=request.user, **serializer.validated_data)
        return Response(DeskNoteSerializer(note, context={"request": request}).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        note = self.get_object()
        return Response(DeskNoteSerializer(note, context={"request": request}).data)

    def partial_update(self, request, *args, **kwargs):
        note = self.get_object()
        serializer = DeskNoteActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = DeskNoteService.apply_action(actor=request.user, note=note, action=serializer.validated_data["action"])
        return Response({"id": note.id, "read": note.read, "pinned": note.pinned, "archived": note.archived})

    def destroy(self, request, *args, **kwargs):
        """`DELETE /api/v1/desk-notes/<id>/` — réplica exacta de
        `route.ts` (`src/app/api/desk-notes/[id]/route.ts`) — Fase 14
        (ver docs/AUDIT_LOG.md § 2026-08-20). Dos vías de eliminación
        distintas por actor, ver docstrings de
        `DeskNoteService.trash_note`/`delete_archived_note_permanently`.
        Chequeos manuales (no vía `get_permissions`) porque
        `CanUseDeskNotes` ya se aplicó (fallback de `get_permissions`)
        y el resto de la lógica depende del ROL DEL ACTOR frente a la
        nota (remitente/destinatario/ninguno), no de un permiso fijo."""
        note = self.get_queryset().filter(pk=kwargs["pk"]).first()
        if note is None:
            return Response({"error": "Nota no encontrada"}, status=404)

        if note.sender_id == request.user.id:
            try:
                DeskNoteService.trash_note(actor=request.user, note=note)
            except RecoveryError as exc:
                return Response({"error": str(exc)}, status=409)
            return Response({"success": True})

        if note.recipient_id == request.user.id:
            if not note.archived:
                return Response({"error": "Solo puedes eliminar definitivamente una nota ya archivada"}, status=409)
            DeskNoteService.delete_archived_note_permanently(actor=request.user, note=note)
            return Response({"success": True})

        return Response({"error": "Sin permisos"}, status=403)

    @action(detail=False, methods=["get"])
    def recipients(self, request):
        """Réplica de `GET /desk-notes/recipients` — cualquier
        colaborador no-Administrador salvo uno mismo, sin jerarquía."""
        candidates = User.objects.exclude(id=request.user.id).prefetch_related("groups").order_by("first_name", "username")
        eligible = [u for u in candidates if role_name(u) != "ADMINISTRADOR"]
        return Response(DeskNoteRecipientSerializer(eligible, many=True).data)

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        if not can_use_desk_notes(request.user):
            return Response({"unread": 0})
        count = DeskNote.objects.filter(recipient=request.user, read=False, archived=False).count()
        return Response({"unread": count})

    @action(detail=True, methods=["get", "post"])
    def replies(self, request, pk=None):
        note = self.get_object()
        if request.method == "GET":
            replies = note.replies.select_related("author").all()
            return Response(DeskNoteReplySerializer(replies, many=True).data)

        other_party = DeskNoteReplyService.other_party(actor=request.user, note=note)
        max_replies = get_effective_desk_note_max_replies(timezone.now())
        if note.replies.count() >= max_replies:
            return Response({"error": "Esta conversación alcanzó el límite permitido."}, status=status.HTTP_409_CONFLICT)

        serializer = ReplyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reply = DeskNoteReplyService.create_reply(
            actor=request.user, note=note, other_party=other_party, **serializer.validated_data
        )
        return Response(DeskNoteReplySerializer(reply).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        note = self.get_object()
        events = DeskAuditLog.objects.filter(entity_type="NOTE", entity_id=note.id)
        return Response(DeskAuditLogSerializer(events, many=True).data)

    @action(detail=True, methods=["get"])
    def attachment(self, request, pk=None):
        """Réplica de `GET /desk-notes/[id]/attachment` — descarga bajo
        demanda (el listado nunca incluye `attachment_data`). A
        propósito NO usa `self.get_object()`: el TS chequea "no
        encontrado/sin adjunto" (404) ANTES que "sin permisos" (403),
        así que se replica con una búsqueda manual en vez del
        permiso de objeto de `CanAccessDeskNote` (que respondería 403
        primero, sin importar si hay adjunto)."""
        note = DeskNote.objects.filter(pk=pk).first()
        if note is None or not note.attachment_data:
            return Response({"error": "Adjunto no encontrado"}, status=status.HTTP_404_NOT_FOUND)
        if request.user.id not in (note.sender_id, note.recipient_id):
            return Response({"error": "Sin permisos"}, status=status.HTTP_403_FORBIDDEN)

        _, _, payload = note.attachment_data.partition(",")
        content = base64.b64decode(payload) if payload else b""
        response = HttpResponse(content, content_type=note.attachment_mime or "application/octet-stream")
        filename = (note.attachment_name or "adjunto").replace('"', "")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="convert-to-reminder")
    def convert_to_reminder(self, request, pk=None):
        """Réplica de `POST /desk-notes/[id]/convert-to-reminder` — a
        propósito NO usa `self.get_object()`: es exclusivo del
        DESTINATARIO (no del remitente, a diferencia de
        `CanAccessDeskNote`, que permite ambos), y el TS chequea "no
        encontrada" (404) ANTES que "sin permisos" (403), mismo criterio
        que `attachment`/`DeskReminderViewSet.convert_to_task`."""
        note = DeskNote.objects.filter(pk=pk).first()
        if note is None:
            return Response({"error": "Nota no encontrada"}, status=status.HTTP_404_NOT_FOUND)
        if note.recipient_id != request.user.id:
            return Response({"error": "Sin permisos"}, status=status.HTTP_403_FORBIDDEN)
        if note.converted_to_reminder_id:
            return Response({"error": "Esta nota ya fue convertida en recordatorio"}, status=status.HTTP_409_CONFLICT)

        serializer = ConvertNoteToReminderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reminder = DeskNoteService.convert_to_reminder(actor=request.user, note=note, **serializer.validated_data)
        return Response({"reminder_id": reminder.id, "reminder_title": reminder.title}, status=status.HTTP_201_CREATED)


class DeskReminderViewSet(viewsets.ModelViewSet):
    """Fases 7b-7c de la migración de stack (ver docs/AUDIT_LOG.md §
    2026-08-17) — Escritorio Digital: Recordatorios, CRUD core +
    `convert-to-task`. Sin adjuntos todavía (sub-fase propia, sin
    planificar en detalle). **Sin cutover de `route.ts` todavía.** A
    diferencia de `DeskNoteViewSet`, el queryset ya filtra por dueño en
    TODAS las acciones estándar — réplica exacta del TS, que responde
    404 (no 403) para un recordatorio de otro usuario, en vez de
    revelar que existe. `convert_to_task` es la única excepción
    deliberada: busca el recordatorio sin el filtro de dueño y
    responde 403 explícito, réplica exacta de que en el TS es su
    propio `route.ts` aislado (no pasa por el helper genérico de
    lista) — ver su docstring."""

    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    serializer_class = PersonalReminderSerializer
    permission_classes = [IsReminderOwner]

    def get_queryset(self):
        return PersonalReminder.objects.filter(user=self.request.user)

    def list(self, request, *args, **kwargs):
        notify_due_reminders(request.user)

        qs = self.get_queryset().filter(archived=request.query_params.get("archived") == "true")
        status_param = request.query_params.get("status")
        if status_param in (PersonalReminder.Status.PENDIENTE, PersonalReminder.Status.COMPLETADO):
            qs = qs.filter(status=status_param)
        from_param = request.query_params.get("from")
        to_param = request.query_params.get("to")
        if from_param:
            qs = qs.filter(due_at__gte=from_param)
        if to_param:
            qs = qs.filter(due_at__lte=to_param)

        reminders = qs.order_by("due_at")
        limit_param = request.query_params.get("limit")
        if limit_param:
            try:
                limit = max(1, min(200, int(limit_param)))
                reminders = reminders[:limit]
            except ValueError:
                pass
        return Response(PersonalReminderSerializer(reminders, many=True).data)

    def create(self, request, *args, **kwargs):
        serializer = PersonalReminderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reminder = PersonalReminderService.create_reminder(actor=request.user, **serializer.validated_data)
        return Response(PersonalReminderSerializer(reminder).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        """Réplica de la cascada de `if` de
        `PATCH /desk-reminders/[id]` — `action` decide la rama, o
        edición directa de campos si no viene ninguna."""
        reminder = self.get_object()
        action_name = request.data.get("action")

        if action_name == "complete":
            reminder = PersonalReminderService.complete(actor=request.user, reminder=reminder)
        elif action_name == "postpone":
            serializer = ReminderDueAtSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            reminder = PersonalReminderService.postpone(actor=request.user, reminder=reminder, **serializer.validated_data)
        elif action_name == "reopen":
            if reminder.status != PersonalReminder.Status.COMPLETADO:
                return Response({"error": "Solo se puede reabrir un recordatorio completado"}, status=status.HTTP_409_CONFLICT)
            serializer = ReminderReopenSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            reminder = PersonalReminderService.reopen(actor=request.user, reminder=reminder, **serializer.validated_data)
        elif action_name in ("archive", "unarchive"):
            reminder = PersonalReminderService.set_archived(actor=request.user, reminder=reminder, archived=action_name == "archive")
        else:
            serializer = PersonalReminderUpdateSerializer(data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            reminder = PersonalReminderService.edit(actor=request.user, reminder=reminder, fields=serializer.validated_data)

        return Response(PersonalReminderSerializer(reminder).data)

    def destroy(self, request, *args, **kwargs):
        reminder = self.get_object()
        reminder_id = reminder.id
        reminder.delete()
        log_desk_audit(entity_type="REMINDER", entity_id=reminder_id, user=request.user, action=DeskAuditAction.DELETED)
        return Response({"ok": True})

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        reminder = self.get_object()
        events = DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=reminder.id)
        return Response(DeskAuditLogSerializer(events, many=True).data)

    @action(detail=True, methods=["post"], url_path="convert-to-task")
    def convert_to_task(self, request, pk=None):
        """Réplica de `POST /desk-reminders/[id]/convert-to-task` — a
        propósito NO usa `self.get_object()` (que filtra por dueño y
        devolvería 404 para un recordatorio ajeno, como el resto de
        esta clase): el `route.ts` original es un endpoint aislado que
        busca el recordatorio sin filtrar y devuelve 403 explícito para
        quien no es el dueño, distinto del resto del módulo."""
        reminder = PersonalReminder.objects.filter(pk=pk).first()
        if reminder is None:
            return Response({"error": "Recordatorio no encontrado"}, status=status.HTTP_404_NOT_FOUND)
        if reminder.user_id != request.user.id:
            return Response({"error": "Sin permisos"}, status=status.HTTP_403_FORBIDDEN)
        if reminder.converted_to_task_id:
            return Response({"error": "Este recordatorio ya fue convertido en tarea"}, status=status.HTTP_409_CONFLICT)

        serializer = ConvertReminderToTaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = PersonalReminderService.convert_to_task(actor=request.user, reminder=reminder, **serializer.validated_data)
        return Response({"task_id": task.id, "task_title": task.title}, status=status.HTTP_201_CREATED)


# ── Fase 7f (ver docs/AUDIT_LOG.md § 2026-08-17) — Bandeja Hoy + Buscador ──────


class DeskTodayView(APIView):
    """Réplica de `GET /api/desk/today` — "Bandeja Hoy": resumen de 4
    bloques de solo lectura (Notas/Recordatorios propios de Escritorio
    Digital + consultas de solo lectura contra Trabajo/Proyectos, sin
    modificarlos). "Proyectos con actividad reciente" usa una ventana
    fija de `RECENT_PROJECT_DAYS` en vez de "desde la última visita"
    real — mismo gap ya aceptado en el TS (`User` no guarda un
    timestamp de última visita al Escritorio)."""

    permission_classes = [CanUseDeskNotes]

    UPCOMING_TASK_DAYS = 7
    RECENT_PROJECT_DAYS = 7
    BLOCK_LIMIT = 8

    def get(self, request):
        notify_due_reminders(request.user)

        _, today_end = business_day_real_range(business_calendar_day(timezone.now()))
        now = timezone.now()
        upcoming_task_cutoff = now + timedelta(days=self.UPCOMING_TASK_DAYS)
        recent_project_cutoff = now - timedelta(days=self.RECENT_PROJECT_DAYS)

        pending_notes = (
            DeskNote.objects.filter(recipient=request.user, read=False, archived=False)
            .select_related("sender")
            .order_by("-pinned", "-created_at")[: self.BLOCK_LIMIT]
        )
        today_reminders = PersonalReminder.objects.filter(
            user=request.user, status=PersonalReminder.Status.PENDIENTE, due_at__lte=today_end
        ).order_by("due_at")[: self.BLOCK_LIMIT]
        upcoming_tasks = (
            Task.objects.filter(assigned_to=request.user, archived_month__isnull=True, end_date__lte=upcoming_task_cutoff)
            .exclude(status=Task.Status.COMPLETADA)
            .order_by("end_date")[: self.BLOCK_LIMIT]
        )
        recent_projects = (
            Project.objects.filter(deleted_at__isnull=True)
            .filter(Q(responsible=request.user) | Q(participants__user=request.user))
            .filter(
                Q(activities__created_at__gte=recent_project_cutoff)
                | Q(comments__created_at__gte=recent_project_cutoff)
                | Q(history__created_at__gte=recent_project_cutoff)
            )
            .distinct()
            .order_by("-updated_at")[: self.BLOCK_LIMIT]
        )

        return Response(
            {
                "pending_notes": [
                    {
                        "id": n.id,
                        "message": n.message,
                        "priority": n.priority,
                        "color": n.color,
                        "created_at": n.created_at,
                        "sender_name": n.sender.first_name or n.sender.username,
                    }
                    for n in pending_notes
                ],
                "today_reminders": [
                    {
                        "id": r.id,
                        "title": r.title,
                        "due_at": r.due_at,
                        "priority": r.priority,
                        "overdue": r.due_at < now,
                    }
                    for r in today_reminders
                ],
                "upcoming_tasks": [
                    {"id": t.id, "title": t.title, "end_date": t.end_date, "priority": t.priority, "status": t.status}
                    for t in upcoming_tasks
                ],
                "recent_projects": [
                    {"id": p.id, "name": p.name, "status": p.status, "updated_at": p.updated_at} for p in recent_projects
                ],
            }
        )


class DeskSearchView(APIView):
    """Réplica de `GET /api/desk/search` — buscador único del
    Escritorio Digital: localiza simultáneamente notas y recordatorios
    sin que el usuario deba cambiar de sección. Los filtros remitente/
    destinatario solo aplican a notas (los recordatorios son
    personales, sin ninguno de los dos)."""

    permission_classes = [CanUseDeskNotes]

    RESULT_LIMIT = 50

    @staticmethod
    def _parse_date_range(date_param: str) -> tuple[datetime, datetime] | None:
        try:
            day = datetime.strptime(date_param, "%Y-%m-%d").date()
        except ValueError:
            return None
        # Réplica exacta del TS: `${date}T00:00:00.000Z`/`T23:59:59.999Z`
        # — UTC explícito, no el huso de negocio que sí usa "Bandeja Hoy".
        return (
            datetime.combine(day, time.min, tzinfo=dt_timezone.utc),
            datetime.combine(day, time.max, tzinfo=dt_timezone.utc),
        )

    def get(self, request):
        params = request.query_params
        q = params.get("q", "").strip()
        priority = params.get("priority", "")
        date_range = self._parse_date_range(params.get("date", "")) if params.get("date") else None
        sender_name = params.get("sender", "").strip()
        recipient_name = params.get("recipient", "").strip()
        status_param = params.get("status", "")  # PENDIENTE | LEIDA | ARCHIVADA | COMPLETADO

        notes = DeskNote.objects.filter(Q(sender=request.user) | Q(recipient=request.user))
        if q:
            notes = notes.filter(Q(message__icontains=q) | Q(replies__message__icontains=q)).distinct()
        if priority in DeskNote.Priority.values:
            notes = notes.filter(priority=priority)
        if date_range:
            notes = notes.filter(created_at__range=date_range)
        if sender_name:
            # Réplica aproximada de `sender.name` (Prisma) — Django no tiene
            # un campo "name" propio, `DeskUserRefSerializer` ya lo resuelve
            # como `first_name or username` en el resto del módulo.
            notes = notes.filter(Q(sender__first_name__icontains=sender_name) | Q(sender__username__icontains=sender_name))
        if recipient_name:
            notes = notes.filter(
                Q(recipient__first_name__icontains=recipient_name) | Q(recipient__username__icontains=recipient_name)
            )
        if status_param == "PENDIENTE":
            notes = notes.filter(read=False, archived=False)
        elif status_param == "LEIDA":
            notes = notes.filter(read=True, archived=False)
        elif status_param == "ARCHIVADA":
            notes = notes.filter(archived=True)
        notes = notes.select_related("sender", "recipient").order_by("-created_at")[: self.RESULT_LIMIT]

        reminders = PersonalReminder.objects.filter(user=request.user)
        if q:
            reminders = reminders.filter(Q(title__icontains=q) | Q(description__icontains=q))
        if priority in PersonalReminder.Priority.values:
            reminders = reminders.filter(priority=priority)
        if date_range:
            reminders = reminders.filter(due_at__range=date_range)
        if status_param in (PersonalReminder.Status.PENDIENTE, PersonalReminder.Status.COMPLETADO):
            reminders = reminders.filter(status=status_param)
        reminders = reminders.order_by("-due_at")[: self.RESULT_LIMIT]

        return Response(
            {
                "notes": [
                    {
                        "id": n.id,
                        "message": n.message,
                        "priority": n.priority,
                        "color": n.color,
                        "read": n.read,
                        "archived": n.archived,
                        "created_at": n.created_at,
                        "sender_id": n.sender_id,
                        "sender_name": n.sender.first_name or n.sender.username,
                        "recipient_id": n.recipient_id,
                        "recipient_name": n.recipient.first_name or n.recipient.username,
                        "is_mine": n.sender_id == request.user.id,
                        "reply_count": n.replies.count(),
                    }
                    for n in notes
                ],
                "reminders": [
                    {
                        "id": r.id,
                        "title": r.title,
                        "description": r.description,
                        "due_at": r.due_at,
                        "priority": r.priority,
                        "status": r.status,
                    }
                    for r in reminders
                ],
            }
        )
