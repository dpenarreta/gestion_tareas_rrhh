"""Siembra a `ADMINISTRADOR` TODOS los codenames del catálogo (los 5
módulos administrativos originales heredados de `skelleton_base` —
`usuarios`/`roles`/`permisos`/`configuracion`/`auditoria` — más los 10
módulos de negocio agregados en `0003_seed_business_module_permissions`),
en vez de depender únicamente del bypass nativo de `is_superuser=True`.

Pedido explícito del usuario: "crea un rol de SuperUsuario que tenga
control de todos los permisos, tenga asignado todo por defecto" — aclarado
con `AskUserQuestion` que NO se trata de un rol nuevo (`Role` sigue fijo en
11 valores), sino de que el rol `ADMINISTRADOR` ya existente tenga
explícitamente TODO el catálogo asignado en la base, no solo en apariencia
(la pantalla `/admin/roles` ya lo mostraba con todo tildado de forma
puramente cosmética — `RolesPermissionsManager.tsx` fuerza
`effectiveSelected = allCodenames` para la fila de Administrador,
independientemente de lo que hubiera en la base). Ver
docs/AUDIT_LOG.md § 2026-09-01 (entrada de seguimiento).

Efecto real (más allá de lo cosmético): un usuario ADMINISTRADOR-solo-por-
-grupo (`is_superuser=False` — estado real alcanzable, `UserAdminService.create_user`
nunca setea `is_superuser`) pasa a tener acceso a TODO, incluido
`escritorio_digital.usar` — que `0003` había excluido a propósito para
ADMINISTRADOR (`docs/DECISIONS.md`: "no es un participante operativo del
día a día"). Esa exclusión queda revertida por pedido explícito del
usuario ("todo por defecto", sin excepciones) — un ADMINISTRADOR real
(`is_superuser=True`) ya tenía acceso de todas formas vía el bypass nativo,
así que esto solo cierra el caso no-superuser para que sea consistente con
"todos los permisos".

Usa `.add()` con el set completo (nunca `.set()`) — es una operación
aditiva pura sobre lo que ya sembró `0003`, sin pisar nada."""

from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations


def seed_all_permissions_to_administrador(apps, schema_editor):
    create_permissions(
        global_apps.get_app_config("permissions"),
        verbosity=0,
        using=schema_editor.connection.alias,
    )

    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    content_type = ContentType.objects.get(app_label="permissions", model="modulepermission")
    administrador = Group.objects.get(name="ADMINISTRADOR")
    all_permissions = Permission.objects.filter(content_type=content_type)
    administrador.permissions.add(*all_permissions)


def noop_reverse(apps, schema_editor):
    # No se revierte la asignación: es configuración, mismo criterio que
    # `0003_seed_business_module_permissions.noop_reverse`.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("permissions", "0003_seed_business_module_permissions"),
    ]

    operations = [
        migrations.RunPython(seed_all_permissions_to_administrador, noop_reverse),
    ]
