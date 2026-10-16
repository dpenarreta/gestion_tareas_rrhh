"""Siembra a `ADMINISTRADOR` los permisos del catálogo agregados después de
`0004_seed_all_permissions_to_administrador`, que este rol debe tener
explícitamente en la base (ver la docstring de `0004`):

- `novedades.ingresos_ver` y `novedades.salidas_ver` (Ingresos y Salidas,
  `0009`, 2026-10-14) — habían quedado sin sembrar.
- `novedades.dias_editar` (Editar celdas de Días laborados, `0010`,
  2026-10-16).

Aditiva pura (`.add()`, nunca `.set()`); no toca a ningún otro rol: para los
demás, estos permisos se conceden por persona o por rol desde Ajustes."""

from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations

CODENAMES = ("novedades.ingresos_ver", "novedades.salidas_ver", "novedades.dias_editar")


def seed(apps, schema_editor):
    create_permissions(
        global_apps.get_app_config("permissions"),
        verbosity=0,
        using=schema_editor.connection.alias,
    )
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    content_type = ContentType.objects.get(app_label="permissions", model="modulepermission")
    administrador = Group.objects.filter(name="ADMINISTRADOR").first()
    if administrador is None:
        return
    administrador.permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=CODENAMES)
    )


def noop_reverse(apps, schema_editor):
    # Configuración: no se revierte (mismo criterio que `0004`).
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("permissions", "0010_worked_days_edit_permission"),
    ]

    operations = [migrations.RunPython(seed, noop_reverse)]
