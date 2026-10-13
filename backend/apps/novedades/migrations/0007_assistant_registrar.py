"""El Asistente de Operaciones registra y corrige novedades de fechas pasadas
(decisión del usuario, 2026-10-13, ver docs/AUDIT_LOG.md § 2026-10-13 —
plazos de registro). `novedades.registrar` pasa de "no disponible" a
"configurable" para ese rol y se le habilita por defecto aquí; se puede
apagar desde Ajustes. Aditivo, mismo criterio que 0002; el reverse lo quita."""

from django.db import migrations

ASSISTANT = "ASISTENTE_OPERACIONES"
CODENAME = "novedades.registrar"


def _permission(apps):
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    content_type = ContentType.objects.filter(
        app_label="permissions", model="modulepermission"
    ).first()
    if content_type is None:
        return None
    return Permission.objects.filter(content_type=content_type, codename=CODENAME).first()


def grant(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    group = Group.objects.filter(name=ASSISTANT).first()
    permission = _permission(apps)
    if group is not None and permission is not None:
        group.permissions.add(permission)


def revoke(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    group = Group.objects.filter(name=ASSISTANT).first()
    permission = _permission(apps)
    if group is not None and permission is not None:
        group.permissions.remove(permission)


class Migration(migrations.Migration):
    dependencies = [("novedades", "0006_overtime_month_close")]

    operations = [migrations.RunPython(grant, revoke)]
