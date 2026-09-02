import json

from django.http import HttpResponse
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.request_meta import get_request_context

from .models import DataSubjectRequest
from .permissions import is_administrator
from .serializers import (
    DataRequestCreateSerializer,
    DataRequestStatusSerializer,
    DataSubjectRequestFlatSerializer,
    DataSubjectRequestSerializer,
)
from .services import create_data_request, export_my_data, resolve_data_request


def _queryset():
    return DataSubjectRequest.objects.select_related("user", "resolved_by").prefetch_related(
        "user__groups"
    )


class DataRequestListCreateView(generics.GenericAPIView):
    """`GET/POST /api/v1/data-requests/` — réplica de `route.ts`
    (`src/app/api/data-requests/route.ts`) — Fase 12 (ver
    docs/AUDIT_LOG.md § 2026-08-19). `GET` lista todas las solicitudes
    si el actor es Administrador, o solo las propias si no. Crear una
    solicitud NO requiere ningún rol especial."""

    permission_classes = [IsAuthenticated]
    serializer_class = DataRequestCreateSerializer

    def get(self, request):
        queryset = _queryset()
        if not is_administrator(request.user):
            queryset = queryset.filter(user=request.user)
        serializer = DataSubjectRequestSerializer(queryset.order_by("-created_at"), many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Tipo de solicitud inválido"}, status=400)

        data = serializer.validated_data
        data_request = create_data_request(
            user=request.user,
            type=data["type"],
            description=data.get("description"),
            context=get_request_context(request),
        )
        return Response(DataSubjectRequestFlatSerializer(data_request).data, status=201)


class DataRequestDetailView(generics.GenericAPIView):
    """`PATCH /api/v1/data-requests/<request_id>/` — réplica de
    `route.ts` (`src/app/api/data-requests/[id]/route.ts`) — Fase 12
    (ver docs/AUDIT_LOG.md § 2026-08-19). Solo Administrador."""

    permission_classes = [IsAuthenticated]
    serializer_class = DataRequestStatusSerializer

    def patch(self, request, request_id: int):
        if not is_administrator(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Estado inválido"}, status=400)

        data_request = DataSubjectRequest.objects.filter(pk=request_id).first()
        if data_request is None:
            return Response({"error": "Solicitud no encontrada"}, status=404)

        resolve_data_request(
            data_request=data_request,
            status=serializer.validated_data["status"],
            resolver=request.user,
            context=get_request_context(request),
        )
        updated = _queryset().get(pk=data_request.id)
        return Response(DataSubjectRequestSerializer(updated).data)


class MyDataExportView(generics.GenericAPIView):
    """`GET /api/v1/data-requests/my-data/` — réplica de `route.ts`
    (`src/app/api/data-requests/my-data/route.ts`) — Fase 12 (ver
    docs/AUDIT_LOG.md § 2026-08-19). Exporta un archivo JSON
    descargable con todos los datos operativos del titular."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        payload = export_my_data(user=request.user, context=get_request_context(request))
        content = json.dumps(payload, indent=2, ensure_ascii=False, default=str)
        response = HttpResponse(content, content_type="application/json")
        response["Content-Disposition"] = (
            f'attachment; filename="nexo-mis-datos-{request.user.id}.json"'
        )
        return response
