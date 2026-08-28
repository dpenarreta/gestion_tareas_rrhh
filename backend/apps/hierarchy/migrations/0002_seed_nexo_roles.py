"""Siembra los 11 roles de Nexo como `auth.Group` y las reglas de
visibilidad/notificación entre ellos, copiadas EXACTAMENTE de
`src/lib/roles.ts` (VISIBLE_ROLES/NOTIFICATION_TARGETS) del Next.js legacy —
ver `apps/hierarchy/tests/test_seed_matches_legacy_roles.py`, que compara esta
seed contra esos mismos valores para detectar cualquier divergencia futura.

ADMINISTRADOR se crea como Group (para que pueda aparecer en RoleVisibility
como viewer/visible como cualquier otro rol) pero, a diferencia de JEFE_NACIONAL
y COORDINADOR_NACIONAL, no recibe permisos del catálogo aquí: el bypass real
de "administrador" en Nexo se otorga vía `User.is_superuser=True` en el
momento de creación de la cuenta (ver `migrate_users_from_postgres` y
docs/roles-and-permissions.md § AC-038 de skelleton_base), igual que hace el
skeleton original con su propio rol "Superusuario"."""

from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations

ROLE_NAMES = [
    "ADMINISTRADOR",
    "JEFE_NACIONAL",
    "COORDINADOR_NACIONAL",
    "COORDINADOR_ZS",
    "ANALISTA_CC",
    "ANALISTA_SELECCION",
    "ASISTENTE_SELECCION",
    "ASISTENTE_GH",
    "ASISTENTE_GH_ZS",
    "TRABAJO_SOCIAL",
    "ASISTENTE_NOMINA",
]

# Copia literal de VISIBLE_ROLES (src/lib/roles.ts) — incluye la fila
# reflexiva (todo rol se ve a sí mismo).
VISIBLE_ROLES = {
    "ADMINISTRADOR": ROLE_NAMES,
    "JEFE_NACIONAL": [
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
        "ASISTENTE_NOMINA",
    ],
    "COORDINADOR_NACIONAL": [
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
        "ASISTENTE_NOMINA",
    ],
    "COORDINADOR_ZS": ["COORDINADOR_ZS", "ASISTENTE_GH_ZS"],
    "ANALISTA_CC": ["ANALISTA_CC", "ASISTENTE_GH", "TRABAJO_SOCIAL"],
    "ANALISTA_SELECCION": [
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "TRABAJO_SOCIAL",
    ],
    "ASISTENTE_SELECCION": ["ASISTENTE_SELECCION"],
    "ASISTENTE_GH": ["ASISTENTE_GH"],
    "ASISTENTE_GH_ZS": ["ASISTENTE_GH_ZS"],
    "TRABAJO_SOCIAL": ["TRABAJO_SOCIAL"],
    "ASISTENTE_NOMINA": ["ASISTENTE_NOMINA"],
}

# Copia literal de NOTIFICATION_TARGETS (src/lib/roles.ts).
NOTIFICATION_TARGETS = {
    "ADMINISTRADOR": [],
    "JEFE_NACIONAL": [],
    "COORDINADOR_NACIONAL": ["JEFE_NACIONAL"],
    "COORDINADOR_ZS": ["COORDINADOR_NACIONAL"],
    "ANALISTA_CC": ["COORDINADOR_NACIONAL"],
    "ANALISTA_SELECCION": ["COORDINADOR_NACIONAL"],
    "ASISTENTE_SELECCION": ["ANALISTA_SELECCION"],
    "ASISTENTE_GH": ["ANALISTA_CC", "ANALISTA_SELECCION"],
    "ASISTENTE_GH_ZS": ["COORDINADOR_ZS"],
    "TRABAJO_SOCIAL": ["ANALISTA_CC", "ANALISTA_SELECCION"],
    "ASISTENTE_NOMINA": ["COORDINADOR_NACIONAL", "JEFE_NACIONAL"],
}

# Paridad con CAN_MANAGE_USERS/CAN_ACCESS_REPORTS (roles.ts): JEFE_NACIONAL y
# COORDINADOR_NACIONAL administran usuarios y consultan roles/permisos/auditoría.
ADMIN_GROUP_PERMISSION_CODENAMES = [
    "usuarios.ver",
    "usuarios.crear",
    "usuarios.editar",
    "usuarios.deshabilitar",
    "usuarios.restablecer_password",
    "roles.ver",
    "permisos.ver",
    "auditoria.ver",
]
GROUPS_WITH_ADMIN_PERMISSIONS = ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"]


def seed_nexo_roles(apps, schema_editor):
    # Ver comentario equivalente en apps/roles/migrations/0001_initial.py:
    # sin esto, `ContentType.objects.get(...)` más abajo falla en una base
    # de datos nueva migrada de una sola vez (ej. pytest-django).
    create_permissions(
        global_apps.get_app_config("permissions"),
        verbosity=0,
        using=schema_editor.connection.alias,
    )

    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    RoleVisibility = apps.get_model("hierarchy", "RoleVisibility")
    RoleNotificationTarget = apps.get_model("hierarchy", "RoleNotificationTarget")

    groups = {name: Group.objects.get_or_create(name=name)[0] for name in ROLE_NAMES}

    for viewer_name, visible_names in VISIBLE_ROLES.items():
        for visible_name in visible_names:
            RoleVisibility.objects.get_or_create(
                viewer_group=groups[viewer_name], visible_group=groups[visible_name]
            )

    for source_name, target_names in NOTIFICATION_TARGETS.items():
        for target_name in target_names:
            RoleNotificationTarget.objects.get_or_create(
                source_group=groups[source_name], target_group=groups[target_name]
            )

    content_type = ContentType.objects.get(app_label="permissions", model="modulepermission")
    admin_permissions = Permission.objects.filter(
        content_type=content_type, codename__in=ADMIN_GROUP_PERMISSION_CODENAMES
    )
    for group_name in GROUPS_WITH_ADMIN_PERMISSIONS:
        groups[group_name].permissions.set(admin_permissions)


def noop_reverse(apps, schema_editor):
    # No se eliminan roles/reglas al revertir: son configuración, no un dato
    # transaccional del que dependa la reversión del esquema (mismo criterio
    # que la seed de "Superusuario" en apps.roles).
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("hierarchy", "0001_initial"),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("permissions", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_nexo_roles, noop_reverse),
    ]
