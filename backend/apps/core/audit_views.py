import csv
import io

from django.http import HttpResponse
from django.utils import timezone as django_timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import HasModulePermission

from .audit_filters import filter_audit_logs
from .models import AuditLog
from .pagination import DefaultPagination

# Tope defensivo de filas exportadas en una sola llamada — evita que un
# volumen de auditoría muy grande degrade el request.
EXPORT_ROW_LIMIT = 5000


class AuditoriaPermission(HasModulePermission):
    view_permission = "auditoria.ver"
    write_permission = None  # solo lectura: el registro se crea internamente, nunca vía API


class AuditoriaExportarPermission(HasModulePermission):
    view_permission = "auditoria.exportar"
    write_permission = None


class AuditLogSerializer(serializers.ModelSerializer):
    """`previous_values`/`new_values` (el diff) y `location` se ocultan a
    nivel de campo si el usuario no tiene `auditoria.ver_detalle`/
    `auditoria.ver_ubicacion` respectivamente — la lista sigue siendo
    visible con solo `auditoria.ver`, pero sin esos dos campos."""

    actor_username = serializers.CharField(source="actor.username", default=None, read_only=True)
    created_at_local = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor",
            "actor_username",
            "action",
            "module",
            "target_type",
            "target_id",
            "result",
            "previous_values",
            "new_values",
            "ip_address",
            "browser",
            "operating_system",
            "device",
            "location",
            "correlation_id",
            "created_at",
            "created_at_local",
        ]
        read_only_fields = fields

    def get_created_at_local(self, obj: AuditLog) -> str:
        # La zona horaria ya resuelta server-side (settings.TIME_ZONE) —
        # el frontend nunca hace matemática de zonas horarias, solo pinta
        # este string.
        return django_timezone.localtime(obj.created_at).isoformat()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None

        if not user_has_permission(user, "auditoria.ver_detalle"):
            data.pop("previous_values", None)
            data.pop("new_values", None)

        if not user_has_permission(user, "auditoria.ver_ubicacion"):
            data.pop("location", None)

        return data


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Consulta de auditoría, de solo lectura — nunca se crea ni modifica
    vía API, solo internamente desde `apps.core.audit.record_audit_event`."""

    permission_classes = [IsAuthenticated, AuditoriaPermission]
    serializer_class = AuditLogSerializer
    pagination_class = DefaultPagination
    queryset = AuditLog.objects.all().order_by("-created_at")

    def get_queryset(self):
        return filter_audit_logs(super().get_queryset(), self.request.query_params)

    @action(
        detail=False,
        methods=["get"],
        permission_classes=[IsAuthenticated, AuditoriaExportarPermission],
    )
    def export(self, request):
        queryset = filter_audit_logs(
            AuditLog.objects.all().order_by("-created_at"), request.query_params
        )[:EXPORT_ROW_LIMIT]

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            ["id", "fecha", "usuario", "accion", "modulo", "entidad", "id_entidad", "resultado"]
        )
        for entry in queryset:
            writer.writerow(
                [
                    entry.id,
                    django_timezone.localtime(entry.created_at).isoformat(),
                    entry.actor.username if entry.actor else "",
                    entry.action,
                    entry.module,
                    entry.target_type,
                    entry.target_id,
                    entry.result,
                ]
            )

        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="audit_log.csv"'
        return response
