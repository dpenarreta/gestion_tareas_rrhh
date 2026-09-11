"""Asigna el permiso nuevo `usuarios.eliminar` al grupo `ADMINISTRADOR`.

`0004_seed_all_permissions_to_administrador` estableció la política de que
ADMINISTRADOR tiene TODO el catálogo asignado explícitamente en la base
("todo por defecto", pedido explícito del usuario). Esa migración ya corrió,
así que un permiso agregado después no le llega solo: hace falta esta.

Deliberadamente NO se asigna a `JEFE_NACIONAL` ni a `COORDINADOR_NACIONAL`,
que sí tienen el resto de los permisos administrativos de usuarios
(`ADMIN_GROUP_PERMISSION_CODENAMES` en
`apps/hierarchy/migrations/0002_seed_nexo_roles.py`). Borrar una cuenta es
irreversible y arrastra datos personales en cascada; dar de baja, que es lo
que esos roles necesitan para operar, sigue siendo suyo vía
`usuarios.deshabilitar`. Ver docs/AUDIT_LOG.md § 2026-09-11.

Usa `.add()`, aditivo puro, mismo criterio que `0004`.
"""

from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations

CODENAME = "usuarios.eliminar"


def seed_usuarios_eliminar(apps, schema_editor):
    # El permiso nuevo lo crea `create_permissions` a partir del Meta del
    # modelo ancla: en una base ya migrada todavía no existe la fila cuando
    # corre esta migración.
    create_permissions(
        global_apps.get_app_config("permissions"),
        verbosity=0,
        using=schema_editor.connection.alias,
    )

    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    content_type = ContentType.objects.get(app_label="permissions", model="modulepermission")
    try:
        administrador = Group.objects.get(name="ADMINISTRADOR")
    except Group.DoesNotExist:
        # Base sin el seed de roles (no debería pasar, pero una migración no
        # puede asumirlo): sin grupo no hay nada que asignar.
        return

    permiso = Permission.objects.filter(content_type=content_type, codename=CODENAME).first()
    if permiso is not None:
        administrador.permissions.add(permiso)


def noop_reverse(apps, schema_editor):
    # No se revierte: es configuración, mismo criterio que `0003`/`0004`.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("permissions", "0005_alter_modulepermission_options"),
        ("hierarchy", "0002_seed_nexo_roles"),
    ]

    operations = [
        migrations.RunPython(seed_usuarios_eliminar, noop_reverse),
    ]
