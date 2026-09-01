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
`configuracion.*` queda sin una vista propia (fuera de alcance, ver
docs/AUDIT_LOG.md § 2026-09-01: `apps.configuration`/`dashboard`/
`notifications` confían 100% en el guard de frontend, sin gate server-side).

Decisión explícita del usuario (ver docs/AUDIT_LOG.md § 2026-09-01,
"Catálogo dinámico de permisos extendido a todo el sistema"): los módulos
`tareas`/`reportes`/`equipo`/`reuniones`/`mejora_continua`/
`base_conocimiento`/`inteligencia_preventiva`/`proyectos`/
`escritorio_digital`/`announcements` reemplazan los checks de rol
hardcodeados que hasta ahora vivían en cada `permissions.py` de esas apps
(`CAN_CREATE_MEETINGS`/`CAN_ACCESS_REPORTS`/etc., réplicas de
`src/lib/roles.ts`) — la migración de datos que siembra estos permisos por
rol replica EXACTAMENTE el comportamiento que esas constantes ya tenían,
verificado 1:1 contra el código real antes de escribirla (ver
`apps/permissions/migrations/0002_seed_business_module_permissions.py`).
No se modela como permiso la jerarquía de visibilidad entre roles
(`VISIBLE_ROLES`/`NOTIFICATION_TARGETS`, ya vive como datos en
`apps.hierarchy.RoleVisibility`/`RoleNotificationTarget`) ni la
clasificación liderazgo/ejecutor (`ROLE_LEVEL >= 4`, no es una capacidad
togglable) — ambas son ejes de autorización distintos a "puede/no puede
hacer X".
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
    "tareas": {
        "label": "Tareas",
        "description": "Operaciones especiales sobre tareas de todo el equipo.",
        "permissions": {
            "tareas.regularizar": (
                "Regularizar en bloque Tiempo Objetivo/Fecha Fin y ver pendientes de regularización"
            ),
            "tareas.cerrar_mes": "Cerrar el mes de tareas del equipo",
        },
    },
    "reportes": {
        "label": "Reportes Ejecutivos",
        "description": "Generación y consulta de reportes ejecutivos consolidados.",
        "permissions": {
            "reportes.ver": "Ver y generar reportes ejecutivos",
        },
    },
    "equipo": {
        "label": "Equipo",
        "description": "Consulta de subordinados y sus tareas.",
        "permissions": {
            "equipo.ver": "Ver el equipo (subordinados) y sus tareas",
        },
    },
    "reuniones": {
        "label": "Reuniones",
        "description": "Programación de reuniones con integración de Zoom.",
        "permissions": {
            "reuniones.crear": "Crear y programar reuniones",
        },
    },
    "mejora_continua": {
        "label": "Mejora Continua",
        "description": "Revisión y cambio de estado de ideas enviadas por el equipo.",
        "permissions": {
            "mejora_continua.revisar": "Revisar ideas y cambiar su estado",
        },
    },
    "base_conocimiento": {
        "label": "Base de Conocimiento",
        "description": "Documentos indexados que NOVA usa para responder consultas de RRHH.",
        "permissions": {
            "base_conocimiento.ver": "Ver la base de conocimiento y consultarla vía NOVA",
            "base_conocimiento.gestionar": "Subir y eliminar documentos de la base de conocimiento",
        },
    },
    "inteligencia_preventiva": {
        "label": "Inteligencia Preventiva",
        "description": "Índice de Riesgo Operativo y alertas preventivas del equipo.",
        "permissions": {
            "inteligencia_preventiva.ver": "Ver el Índice de Riesgo Operativo del equipo",
        },
    },
    "proyectos": {
        "label": "Proyectos",
        "description": "Creación de iniciativas transversales.",
        "permissions": {
            "proyectos.crear": "Crear un proyecto",
        },
    },
    "escritorio_digital": {
        "label": "Escritorio Digital",
        "description": "Notas y recordatorios de comunicación informal entre colaboradores.",
        "permissions": {
            "escritorio_digital.usar": "Usar el Escritorio Digital (notas y recordatorios)",
        },
    },
    "announcements": {
        "label": "Comunicados",
        "description": "Publicación de comunicados generales para todo el equipo.",
        "permissions": {
            "comunicados.gestionar": "Publicar y eliminar comunicados",
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
