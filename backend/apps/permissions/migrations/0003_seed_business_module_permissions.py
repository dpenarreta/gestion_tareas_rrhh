"""Siembra los permisos de los 10 módulos de negocio agregados al catálogo
(`tareas`/`reportes`/`equipo`/`reuniones`/`mejora_continua`/
`base_conocimiento`/`inteligencia_preventiva`/`proyectos`/
`escritorio_digital`/`announcements`) a los roles que YA tenían esa
capacidad hoy, vía los checks hardcodeados de `src/lib/roles.ts` y sus
réplicas Python (`CAN_CREATE_MEETINGS`/`CAN_ACCESS_REPORTS`/etc.) — ver
docs/AUDIT_LOG.md § 2026-09-01 ("Catálogo dinámico de permisos extendido a
todo el sistema"). Decisión explícita del usuario, con la investigación
verificada 1:1 contra el código real antes de escribir esta migración
(ver tabla completa en el plan de esa entrada de AUDIT_LOG).

Usa `.add()` (nunca `.set()`) porque `JEFE_NACIONAL`/`COORDINADOR_NACIONAL`
ya tienen sembrados `usuarios.*`/`roles.ver`/`permisos.ver`/`auditoria.ver`
desde `apps.hierarchy.migrations.0002_seed_nexo_roles` — `.set()` los
pisaría.

`ADMINISTRADOR` — hallazgo verificado corriendo la suite completa tras el
primer intento de esta migración (sin `ADMINISTRADOR` en ningún codename):
`role_name(user)` (réplica repetida en 6+ `permissions.py`) resuelve
"ADMINISTRADOR" tanto para `is_superuser=True` COMO para un usuario
simplemente asignado al grupo `Group "ADMINISTRADOR"` (`user.groups.first()`)
— y los checks legacy (`CAN_CREATE_MEETINGS`/`CAN_ACCESS_REPORTS`/etc.)
siempre incluían el string `"ADMINISTRADOR"` en su whitelist. `role_level(user)`
(`apps.hierarchy.services`) hace exactamente lo mismo (nivel 5 tanto para
`is_superuser` como para el grupo `ADMINISTRADOR`). Es decir: en este
sistema, "pertenecer al grupo ADMINISTRADOR" YA otorgaba estas capacidades
sin necesitar `is_superuser=True` — un caso real (`UserAdminService.create_user`
nunca setea `is_superuser`, solo asigna el grupo). El catálogo dinámico
(`user_has_permission`) NO replica esa equivalencing: solo bypassea con
`is_superuser=True` real. Para preservar el comportamiento exacto, esta
migración siembra `ADMINISTRADOR` explícitamente en cada codename cuyo
origen (`role_name()`-based) lo incluía — EXCEPTO `tareas.regularizar`
(`CanRegularize` ya comparaba `is_superuser` directo, sin pasar por
`role_name()`), `tareas.cerrar_mes` (ya usaba `usuarios.editar`, que la
seed original de `hierarchy` tampoco le da a `ADMINISTRADOR`) y
`escritorio_digital.usar` (excluye a `ADMINISTRADOR` siempre, por diseño)."""

from django.apps import apps as global_apps
from django.contrib.auth.management import create_permissions
from django.db import migrations

# Codename -> roles que reproducen exactamente el comportamiento actual
# (fuente citada en el docstring de módulo).
CODENAME_ROLES = {
    "tareas.regularizar": ["JEFE_NACIONAL"],
    "tareas.cerrar_mes": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
    "reportes.ver": ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
    "equipo.ver": [
        "ADMINISTRADOR",
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
    ],
    "reuniones.crear": ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"],
    "mejora_continua.revisar": ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
    "base_conocimiento.ver": ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
    "base_conocimiento.gestionar": ["ADMINISTRADOR"],
    "inteligencia_preventiva.ver": [
        "ADMINISTRADOR",
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
    ],
    "proyectos.crear": [
        "ADMINISTRADOR",
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
    ],
    "escritorio_digital.usar": [
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
    "comunicados.gestionar": ["ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
}


def seed_business_module_permissions(apps, schema_editor):
    # Ver comentario equivalente en apps/hierarchy/migrations/0002_seed_nexo_roles.py:
    # sin esto, `ContentType.objects.get(...)` falla en una base nueva
    # migrada de una sola vez (ej. pytest-django).
    create_permissions(
        global_apps.get_app_config("permissions"),
        verbosity=0,
        using=schema_editor.connection.alias,
    )

    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    content_type = ContentType.objects.get(app_label="permissions", model="modulepermission")
    groups = {g.name: g for g in Group.objects.all()}

    for codename, role_names in CODENAME_ROLES.items():
        if not role_names:
            continue
        permission = Permission.objects.get(content_type=content_type, codename=codename)
        for role_name in role_names:
            groups[role_name].permissions.add(permission)


def noop_reverse(apps, schema_editor):
    # No se revierte la asignación: es configuración, mismo criterio que
    # `apps.hierarchy.migrations.0002_seed_nexo_roles.noop_reverse`.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("permissions", "0002_alter_modulepermission_options"),
        ("hierarchy", "0002_seed_nexo_roles"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(seed_business_module_permissions, noop_reverse),
    ]
