from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from apps.permissions.catalog import all_codenames
from apps.permissions.models import ModulePermission


def _module_permission_content_type() -> ContentType:
    return ContentType.objects.get_for_model(ModulePermission)


class RoleSerializer(serializers.ModelSerializer):
    """Representación de un rol (`auth.Group`) con sus permisos del catálogo."""

    permission_codenames = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = ["id", "name", "permission_codenames"]
        read_only_fields = fields

    def get_permission_codenames(self, obj: Group) -> list[str]:
        return sorted(
            obj.permissions.filter(content_type=_module_permission_content_type()).values_list(
                "codename", flat=True
            )
        )


class RoleWriteSerializer(serializers.Serializer):
    """Valida la creación/edición de un rol: nombre único y permisos del catálogo."""

    name = serializers.CharField(max_length=150)
    permission_codenames = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )

    def validate_name(self, value):
        queryset = Group.objects.filter(name__iexact=value)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("Ya existe un rol con ese nombre.")
        return value

    def validate_permission_codenames(self, value):
        missing = [entry for entry in value if entry not in all_codenames()]
        if missing:
            raise serializers.ValidationError(f"Permisos inexistentes: {missing}.")
        return value
