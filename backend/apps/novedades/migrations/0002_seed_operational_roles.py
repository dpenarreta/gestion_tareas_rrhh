"""Siembra los roles operativos del módulo Control Operativo de Novedades y
sus permisos base.

- SUPERVISOR_OPERACIONES y ASISTENTE_OPERACIONES se crean como
  `auth.Group`, igual que los 11 roles de NEXO (ver
  `apps/hierarchy/migrations/0002_seed_nexo_roles.py`), con su fila
  reflexiva de `RoleVisibility` y visibles para ADMINISTRADOR —
  espejo de `VISIBLE_ROLES` en `src/lib/roles.ts` (lo verifica
  `apps/hierarchy/tests/test_seed_matches_legacy_roles.py`).
- ADMINISTRADOR recibe TODO `novedades.*`, misma política "todo por
  defecto" de `permissions/0004`.
- Importar/exportar/consolidado del Supervisor arrancan APAGADOS: el
  pedido es habilitarlos expresamente desde Ajustes.

Aditivo (`.add()`), mismo criterio que `permissions/0006`; el reverse es
noop porque es configuración.
"""

from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations

SUPERVISOR = "SUPERVISOR_OPERACIONES"
ASSISTANT = "ASISTENTE_OPERACIONES"

BASE_PERMISSIONS = {
    "ADMINISTRADOR": [
        "novedades.acceder",
        "novedades.colaboradores_gestionar",
        "novedades.registrar",
        "novedades.consolidado_ver",
        "novedades.historial_ver",
        "novedades.importar",
        "novedades.exportar",
        "novedades.cerrar_periodo",
        "novedades.corregir_cerrado",
        "novedades.administrar",
        "novedades.permisos_gestionar",
    ],
    SUPERVISOR: [
        "novedades.acceder",
        "novedades.colaboradores_gestionar",
        "novedades.registrar",
        "novedades.historial_ver",
        "novedades.cerrar_periodo",
    ],
    ASSISTANT: [
        "novedades.acceder",
        "novedades.consolidado_ver",
        "novedades.historial_ver",
        "novedades.exportar",
    ],
}


def seed(apps, schema_editor):
    create_permissions(
        global_apps.get_app_config("permissions"),
        verbosity=0,
        using=schema_editor.connection.alias,
    )
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    RoleVisibility = apps.get_model("hierarchy", "RoleVisibility")

    supervisor, _ = Group.objects.get_or_create(name=SUPERVISOR)
    assistant, _ = Group.objects.get_or_create(name=ASSISTANT)
    administrador = Group.objects.filter(name="ADMINISTRADOR").first()

    for group in (supervisor, assistant):
        RoleVisibility.objects.get_or_create(viewer_group=group, visible_group=group)
        if administrador is not None:
            RoleVisibility.objects.get_or_create(viewer_group=administrador, visible_group=group)

    content_type = ContentType.objects.get(app_label="permissions", model="modulepermission")
    for group_name, codenames in BASE_PERMISSIONS.items():
        group = Group.objects.filter(name=group_name).first()
        if group is None:
            continue
        permissions = Permission.objects.filter(content_type=content_type, codename__in=codenames)
        group.permissions.add(*permissions)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("novedades", "0001_initial"),
        ("permissions", "0007_alter_modulepermission_options"),
        ("hierarchy", "0002_seed_nexo_roles"),
    ]

    operations = [migrations.RunPython(seed, noop_reverse)]
