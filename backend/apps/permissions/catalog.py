"""Catálogo centralizado de permisos, agrupados por módulo.

Fuente de verdad única y versionada en código (no editable en runtime):
qué permisos existen y a qué módulo pertenecen. Lo que sí es dinámico por
rol/usuario es *cuáles* de estos permisos tiene asignados cada uno — eso
vive en `auth.Group`/`auth.Permission` (ver `apps.permissions.models.ModulePermission`
y `apps.permissions.authorization`).

Convención de nombres: `"<modulo>.<accion>"`, ej. `"usuarios.ver"`.

Este catálogo arrancó como el núcleo base heredado de skelleton_base
(usuarios, roles, permisos, auditoría, configuración) — Nexo no portó el
módulo `branding` del template (no aporta a su dominio), así que
`configuracion.*` queda sin una vista propia hasta que el futuro Centro de
Configuración de Nexo (fuera del alcance de esta fase) lo consuma. Cada
fase de negocio posterior debe sumar aquí sus propias entradas antes de
implementar la vista que las verifica (ver docs/roles-and-permissions.md).
"""

PERMISSION_CATALOG = {
    "usuarios": {
        "label": "Usuarios",
        "description": "Gestión de las cuentas de usuario del sistema.",
        "permissions": {
            "usuarios.ver": "Ver usuarios",
            "usuarios.crear": "Crear usuarios",
            "usuarios.editar": "Editar usuarios y su asignación de roles/permisos",
            "usuarios.deshabilitar": "Habilitar, deshabilitar, bloquear y desbloquear usuarios",
            "usuarios.restablecer_password": (
                "Enviar enlace de restablecimiento, forzar cambio de contraseña en el "
                "próximo inicio o cerrar sesiones activas de un usuario"
            ),
        },
    },
    "roles": {
        "label": "Roles",
        "description": "Gestión de roles y asignación de permisos por módulo.",
        "permissions": {
            "roles.ver": "Ver roles y el catálogo de permisos",
            "roles.editar": "Crear, editar y eliminar roles",
        },
    },
    "permisos": {
        "label": "Permisos",
        "description": "Consulta del catálogo de permisos disponibles en el sistema.",
        "permissions": {
            "permisos.ver": "Ver el catálogo de permisos y a qué módulo pertenece cada uno",
        },
    },
    "configuracion": {
        "label": "Configuración",
        "description": "Configuración general del sistema.",
        "permissions": {
            "configuracion.ver": "Ver configuración del sistema",
            "configuracion.editar": "Editar configuración del sistema",
        },
    },
    "auditoria": {
        "label": "Auditoría",
        "description": "Consulta del registro de auditoría de operaciones administrativas.",
        "permissions": {
            "auditoria.ver": "Ver el registro de auditoría",
            "auditoria.ver_detalle": "Ver el detalle (valores anteriores y nuevos) de un evento",
            "auditoria.ver_ubicacion": "Ver la ubicación aproximada asociada a un evento",
            "auditoria.exportar": "Exportar el registro de auditoría",
        },
    },
}


def iter_all_permissions():
    """Itera `(codename, verbose_name)` de todos los módulos, en el formato
    que Django espera en `Meta.permissions`."""
    for module in PERMISSION_CATALOG.values():
        yield from module["permissions"].items()


def all_codenames() -> set[str]:
    return {codename for codename, _ in iter_all_permissions()}


def all_module_keys() -> set[str]:
    return set(PERMISSION_CATALOG.keys())


def as_django_permission_tuples() -> list[tuple[str, str]]:
    return list(iter_all_permissions())
