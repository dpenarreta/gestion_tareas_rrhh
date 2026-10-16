"""Crea el rol Jefe de Operaciones (pedido del 2026-10-13) con el mismo
mecanismo que los demás roles operativos (ver 0002): `auth.Group`, su fila
reflexiva de `RoleVisibility` y visible para ADMINISTRADOR (espejo de
`VISIBLE_ROLES` en `src/lib/roles.ts`). Permisos base: acceder, consolidado
y depurar. El ADMINISTRADOR recibe `novedades.depurar` por la política "todo
por defecto", pero solo consulta: editar la base depurada exige además el rol
(`NovedadesAccess.can_depurate`). Aditivo; el reverse quita lo agregado."""

from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations

JEFE = "JEFE_OPERACIONES"
JEFE_PERMISSIONS = ["novedades.acceder", "novedades.consolidado_ver", "novedades.depurar"]


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

    jefe, _ = Group.objects.get_or_create(name=JEFE)
    RoleVisibility.objects.get_or_create(viewer_group=jefe, visible_group=jefe)
    administrador = Group.objects.filter(name="ADMINISTRADOR").first()
    if administrador is not None:
        RoleVisibility.objects.get_or_create(viewer_group=administrador, visible_group=jefe)

    content_type = ContentType.objects.get(app_label="permissions", model="modulepermission")
    jefe.permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=JEFE_PERMISSIONS)
    )
    if administrador is not None:
        administrador.permissions.add(
            *Permission.objects.filter(content_type=content_type, codename="novedades.depurar")
        )


def unseed(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    RoleVisibility = apps.get_model("hierarchy", "RoleVisibility")
    jefe = Group.objects.filter(name=JEFE).first()
    if jefe is None or jefe.user_set.exists():
        return  # nunca se quita un rol con usuarios asignados
    RoleVisibility.objects.filter(viewer_group=jefe).delete()
    RoleVisibility.objects.filter(visible_group=jefe).delete()
    jefe.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("novedades", "0008_depuratedovertime_overtimedepuration_and_more"),
        ("permissions", "0008_alter_modulepermission_options"),
        ("hierarchy", "0002_seed_nexo_roles"),
    ]

    operations = [migrations.RunPython(seed, unseed)]
