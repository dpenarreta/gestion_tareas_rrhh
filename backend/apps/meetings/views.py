from django.db.models import Q
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Meeting
from .permissions import can_create_meetings
from .serializers import MeetingCreateSerializer, MeetingPatchSerializer, MeetingSerializer
from .services import create_meeting


def _meeting_queryset():
    return Meeting.objects.select_related("host").prefetch_related("host__groups", "invitees__user__groups")


class MeetingListCreateView(generics.GenericAPIView):
    """`GET/POST /api/v1/meetings/` — réplica de `route.ts`
    (`src/app/api/meetings/route.ts`) — Fase 10 (ver docs/AUDIT_LOG.md
    § 2026-08-19). `GET` lista las reuniones donde el actor es
    anfitrión o invitado (sin excepción para Administrador — ni
    siquiera ve reuniones ajenas donde no participa, réplica fiel del
    TS). `POST` requiere `can_create_meetings`."""

    permission_classes = [IsAuthenticated]
    serializer_class = MeetingCreateSerializer

    def get(self, request):
        meetings = (
            _meeting_queryset()
            .filter(Q(host=request.user) | Q(invitees__user=request.user))
            .distinct()
            .order_by("meeting_date")
        )
        return Response(MeetingSerializer(meetings, many=True).data)

    def post(self, request):
        if not can_create_meetings(request.user):
            return Response({"error": "Sin permisos para crear reuniones"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Faltan campos requeridos"}, status=400)

        data = serializer.validated_data
        meeting, zoom_warning = create_meeting(
            host=request.user,
            title=data["title"],
            description=data.get("description"),
            meeting_date=data["meeting_date"],
            duration=data["duration"],
            invitee_ids=data.get("invitee_ids") or [],
        )
        meeting = _meeting_queryset().get(pk=meeting.id)
        payload = {**MeetingSerializer(meeting).data, "zoom_warning": zoom_warning}
        return Response(payload, status=201)


class MeetingDetailView(generics.GenericAPIView):
    """`GET/PATCH/DELETE /api/v1/meetings/<meeting_id>/` — réplica de
    `route.ts` (`src/app/api/meetings/[id]/route.ts`) — Fase 10 (ver
    docs/AUDIT_LOG.md § 2026-08-19). `GET` requiere ser anfitrión o
    invitado; `PATCH`/`DELETE` requieren ser el anfitrión, SIN
    excepción para Administrador (réplica fiel: el TS no la tiene)."""

    permission_classes = [IsAuthenticated]
    serializer_class = MeetingPatchSerializer

    def get(self, request, meeting_id: int):
        meeting = _meeting_queryset().filter(pk=meeting_id).first()
        if meeting is None:
            return Response({"error": "No encontrada"}, status=404)
        is_participant = meeting.host_id == request.user.id or meeting.invitees.filter(user=request.user).exists()
        if not is_participant:
            return Response({"error": "Sin acceso"}, status=403)
        return Response(MeetingSerializer(meeting).data)

    def patch(self, request, meeting_id: int):
        meeting = Meeting.objects.filter(pk=meeting_id).first()
        if meeting is None:
            return Response({"error": "No encontrada"}, status=404)
        if meeting.host_id != request.user.id:
            return Response({"error": "Solo el anfitrión puede editar la reunión"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Cuerpo de solicitud inválido"}, status=400)

        for field, value in serializer.validated_data.items():
            setattr(meeting, field, value)
        meeting.save()

        meeting = _meeting_queryset().get(pk=meeting.id)
        return Response(MeetingSerializer(meeting).data)

    def delete(self, request, meeting_id: int):
        meeting = Meeting.objects.filter(pk=meeting_id).only("host_id").first()
        if meeting is None:
            return Response({"error": "No encontrada"}, status=404)
        if meeting.host_id != request.user.id:
            return Response({"error": "Solo el anfitrión puede eliminar la reunión"}, status=403)
        meeting.delete()
        return Response({"ok": True})
