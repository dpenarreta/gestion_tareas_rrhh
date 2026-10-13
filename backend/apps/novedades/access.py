"""Autorización del módulo Control Operativo de Novedades.

Combina tres ejes, todos resueltos en el servidor en CADA request (sin
caché propio, así que una revocación surte efecto en la siguiente
comprobación sin requerir relogin):

1. Permisos del catálogo (`novedades.*`) asignados al rol (auth.Group) o
   al usuario — el mismo mecanismo que el resto de NEXO
   (`apps.permissions.authorization`), sin un sistema paralelo.
2. Excepciones individuales (`PermissionOverride`), solo sobre permisos
   CONFIGURABLES: una restricción (DENY) prevalece sobre una concesión.
3. Ámbito de datos, que NO es un permiso y no se configura: el Supervisor
   de Operaciones ve y edita solo su equipo; el Asistente de Operaciones
   lee el consolidado nacional y, desde el 2026-10-13 (decisión del
   usuario), registra y corrige novedades de fechas pasadas de cualquier
   equipo —también fuera del plazo por fecha—; quien tiene
   `novedades.administrar` opera a nivel nacional.

Restricciones obligatorias que ningún ajuste ordinario puede desactivar
(se aplican aquí, por código): un rol operativo nunca obtiene permisos
administrativos del módulo aunque alguien se los asigne en Roles; el
Asistente no gestiona colaboradores, no importa, no cierra períodos ni
meses, no corrige meses cerrados ni cambia Ajustes; nadie registra fechas
futuras; y un usuario no administra sus propios permisos.
"""

from dataclasses import dataclass, field

from apps.permissions.authorization import get_user_permission_codenames

SUPERVISOR_ROLE = "SUPERVISOR_OPERACIONES"
ASSISTANT_ROLE = "ASISTENTE_OPERACIONES"
OPERATIONAL_ROLES = (SUPERVISOR_ROLE, ASSISTANT_ROLE)

ACCEDER = "novedades.acceder"
COLABORADORES = "novedades.colaboradores_gestionar"
REGISTRAR = "novedades.registrar"
CONSOLIDADO = "novedades.consolidado_ver"
HISTORIAL = "novedades.historial_ver"
IMPORTAR = "novedades.importar"
EXPORTAR = "novedades.exportar"
CERRAR = "novedades.cerrar_periodo"
CORREGIR = "novedades.corregir_cerrado"
ADMINISTRAR = "novedades.administrar"
PERMISOS = "novedades.permisos_gestionar"

ALL_CODENAMES = (
    ACCEDER,
    COLABORADORES,
    REGISTRAR,
    CONSOLIDADO,
    HISTORIAL,
    IMPORTAR,
    EXPORTAR,
    CERRAR,
    CORREGIR,
    ADMINISTRAR,
    PERMISOS,
)

# Solo para usuarios fuera de los roles operativos (p. ej. ADMINISTRADOR).
ADMIN_ONLY = frozenset({CORREGIR, ADMINISTRAR, PERMISOS})

# Matriz por rol operativo: "mandatory" = siempre activo (no se puede
# apagar), "configurable" = se activa/desactiva desde Ajustes o por
# excepción individual, "unavailable" = nunca disponible para ese rol.
ROLE_MATRIX = {
    SUPERVISOR_ROLE: {
        ACCEDER: "configurable",
        COLABORADORES: "mandatory",
        REGISTRAR: "configurable",
        CONSOLIDADO: "configurable",
        HISTORIAL: "configurable",
        IMPORTAR: "configurable",
        EXPORTAR: "configurable",
        CERRAR: "configurable",
        CORREGIR: "unavailable",
        ADMINISTRAR: "unavailable",
        PERMISOS: "unavailable",
    },
    ASSISTANT_ROLE: {
        ACCEDER: "configurable",
        COLABORADORES: "unavailable",
        # Registra y corrige fechas pasadas (decisión del 2026-10-13); se
        # habilita por defecto en la migración 0007 y se puede apagar.
        REGISTRAR: "configurable",
        CONSOLIDADO: "configurable",
        HISTORIAL: "configurable",
        IMPORTAR: "unavailable",
        EXPORTAR: "configurable",
        CERRAR: "unavailable",
        CORREGIR: "unavailable",
        ADMINISTRAR: "unavailable",
        PERMISOS: "unavailable",
    },
}


def operational_role_of(user) -> str | None:
    if user is None or not user.is_authenticated:
        return None
    names = set(user.groups.values_list("name", flat=True))
    for role in OPERATIONAL_ROLES:
        if role in names:
            return role
    return None


def is_configurable(role: str | None, codename: str) -> bool:
    return role in ROLE_MATRIX and ROLE_MATRIX[role].get(codename) == "configurable"


def _active_overrides(user):
    from .models import PermissionOverride

    return PermissionOverride.objects.filter(user=user, revoked_at__isnull=True)


def effective_codenames(user) -> set[str]:
    """Permisos efectivos del módulo para el usuario, ya con excepciones y
    restricciones obligatorias aplicadas."""
    if user is None or not user.is_authenticated or not user.is_active:
        return set()
    if user.is_superuser:
        return set(ALL_CODENAMES)

    role = operational_role_of(user)
    granted = {c for c in get_user_permission_codenames(user) if c.startswith("novedades.")}

    if role is None:
        return granted

    matrix = ROLE_MATRIX[role]
    overrides = list(_active_overrides(user).values_list("codename", "effect"))
    for codename, effect in overrides:
        if matrix.get(codename) != "configurable":
            continue
        if effect == "GRANT":
            granted.add(codename)
    for codename, effect in overrides:
        if matrix.get(codename) == "configurable" and effect == "DENY":
            granted.discard(codename)

    for codename, state in matrix.items():
        if state == "mandatory":
            granted.add(codename)
        elif state == "unavailable":
            granted.discard(codename)
    return granted


@dataclass
class NovedadesAccess:
    """Fotografía de la autorización del usuario para UNA request."""

    user: object
    role: str | None
    codenames: set[str] = field(default_factory=set)

    @classmethod
    def for_user(cls, user) -> "NovedadesAccess":
        return cls(user=user, role=operational_role_of(user), codenames=effective_codenames(user))

    def can(self, codename: str) -> bool:
        return codename in self.codenames

    @property
    def is_supervisor(self) -> bool:
        return self.role == SUPERVISOR_ROLE

    @property
    def is_assistant(self) -> bool:
        return self.role == ASSISTANT_ROLE

    @property
    def national_write(self) -> bool:
        """Alcance nacional de escritura (Administrador del módulo)."""
        return self.can(ADMINISTRAR)

    @property
    def national_read(self) -> bool:
        return self.national_write or self.is_assistant

    @property
    def can_view_event_history(self) -> bool:
        """Historial de registros: solo Administrador y Asistente de
        Operaciones. Restricción obligatoria para el Supervisor (decisión de
        producto, 2026-10-12): aunque tenga `novedades.historial_ver`, ese
        permiso solo le habilita el Repositorio mensual."""
        return self.can(HISTORIAL) and not self.is_supervisor

    def readable_supervisor_ids(self) -> list[int] | None:
        """`None` = todos (nacional); lista = solo esos supervisores."""
        if self.national_read:
            return None
        if self.is_supervisor:
            return [self.user.pk]
        return []

    def can_read_supervisor(self, supervisor_id: int) -> bool:
        ids = self.readable_supervisor_ids()
        return ids is None or supervisor_id in ids

    def can_write_for_supervisor(self, supervisor_id: int) -> bool:
        """Ámbito de escritura de novedades (la facultad la da REGISTRAR):
        el Supervisor, su equipo; el Asistente, todos los equipos (su mismo
        ámbito de consulta); el Administrador, nacional. Los cierres, la
        gestión de colaboradores y las correcciones de períodos cerrados
        siguen exigiendo sus propias facultades, que el Asistente no tiene."""
        if self.national_write or self.is_assistant:
            return True
        return self.is_supervisor and supervisor_id == self.user.pk

    @property
    def can_bypass_deadline(self) -> bool:
        """Puede registrar o corregir una fecha cuyo plazo ya venció (queda
        auditado). Nunca habilita fechas futuras ni meses/períodos cerrados."""
        return self.national_write or self.is_assistant

    def as_dict(self) -> dict:
        return {
            "role": self.role,
            "permissions": sorted(self.codenames),
            "is_supervisor": self.is_supervisor,
            "is_assistant": self.is_assistant,
            "national_read": self.national_read,
            "national_write": self.national_write,
            "can_view_history": self.can_view_event_history,
            "can_bypass_deadline": self.can_bypass_deadline,
        }
