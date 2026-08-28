from django.contrib.auth.models import Group

from apps.hierarchy.models import RoleNotificationTarget, RoleVisibility

# Invariante de negocio heredado de Nexo: aunque `auth.Group` permite N roles
# por usuario, toda la lógica de visibilidad/notificación asume 1 rol por
# usuario (ver plan de Fase 1). Estas funciones toman el primer grupo del
# usuario como "su rol" — se valida en `UserAdminService`/serializer que un
# usuario de negocio nunca tenga más de un grupo de rol asignado.


def get_role_group(user) -> Group | None:
    return user.groups.first()


def get_visible_groups(user) -> list[Group]:
    """Roles cuyas tareas/usuarios `user` puede ver, según su propio rol.
    Equivalente a `getVisibleRoles`/`VISIBLE_ROLES` del `roles.ts` legacy."""
    role_group = get_role_group(user)
    if role_group is None:
        return []
    return [
        rv.visible_group
        for rv in RoleVisibility.objects.filter(viewer_group=role_group).select_related(
            "visible_group"
        )
    ]


def is_visible_to(user, target_group: Group) -> bool:
    return target_group in get_visible_groups(user)


def get_notification_target_groups(role_group: Group) -> list[Group]:
    """Roles a los que se notifica cuando ocurre un evento en `role_group`.
    Equivalente a `getNotificationTargets`/`NOTIFICATION_TARGETS` legacy."""
    return [
        nt.target_group
        for nt in RoleNotificationTarget.objects.filter(source_group=role_group).select_related(
            "target_group"
        )
    ]


# Nivel numérico por rol — equivalente a `ROLE_LEVEL` (`src/lib/roles.ts`).
# Vivía duplicado como copia local en `apps.projects.permissions` (único
# consumidor hasta la Fase 9b, ver su propio docstring: "se generaliza
# cuando aparezca un segundo consumidor real, no antes") — Inteligencia
# Preventiva (`team-alerts`/`team-subutilization`, ver docs/AUDIT_LOG.md §
# 2026-08-18) es ese segundo consumidor, así que se centraliza aquí.
ROLE_LEVEL: dict[str, int] = {
    "ADMINISTRADOR": 5,
    "JEFE_NACIONAL": 4,
    "COORDINADOR_NACIONAL": 3,
    "COORDINADOR_ZS": 2,
    "ANALISTA_CC": 2,
    "ANALISTA_SELECCION": 2,
    "ASISTENTE_SELECCION": 1,
    "ASISTENTE_GH": 1,
    "ASISTENTE_GH_ZS": 1,
    "TRABAJO_SOCIAL": 1,
    "ASISTENTE_NOMINA": 1,
}

# Etiquetas legibles por rol — equivalente a `ROLE_LABEL` (`src/lib/roles.ts`).
# Vivía duplicado como copia local en `apps.tasks.services` (único
# consumidor hasta la Fase 28) — el Centro de Configuración
# (`role-targets`/`role-compatibility`, ver docs/AUDIT_LOG.md §
# 2026-08-20) es ese segundo consumidor, mismo criterio de
# centralización ya aplicado a `ROLE_LEVEL` en la Fase 9b.
ROLE_LABEL: dict[str, str] = {
    "ADMINISTRADOR": "Administrador",
    "JEFE_NACIONAL": "Jefe Nacional",
    "COORDINADOR_NACIONAL": "Coordinador Nacional",
    "COORDINADOR_ZS": "Coordinador ZS",
    "ANALISTA_CC": "Analista Clima y Cultura",
    "ANALISTA_SELECCION": "Analista Selección de Personal",
    "ASISTENTE_SELECCION": "Asistente de Selección",
    "ASISTENTE_GH": "Asistente de Gestión Humana",
    "ASISTENTE_GH_ZS": "Asistente GH ZS",
    "TRABAJO_SOCIAL": "Trabajo Social",
    "ASISTENTE_NOMINA": "Asistente de Nómina",
}

# Equivalente a `ALL_ROLES` (`src/lib/roles.ts`) — mismo orden que `ROLE_LABEL`.
ALL_ROLES: list[str] = list(ROLE_LABEL.keys())


def role_level(user) -> int:
    """Nivel numérico del rol del usuario — `is_superuser` siempre
    resuelve a 5 (ADMINISTRADOR), igual que el resto del backend trata
    ese bypass. 0 si no tiene grupo o el grupo no está en la tabla
    (nunca debería pasar en producción, réplica defensiva de un
    `Record` TS completo)."""
    if user.is_superuser:
        return 5
    group = get_role_group(user)
    return ROLE_LEVEL.get(group.name, 0) if group else 0


def is_leadership(user) -> bool:
    """Nivel >= 3 — ADMINISTRADOR/JEFE_NACIONAL/COORDINADOR_NACIONAL."""
    return role_level(user) >= 3


def can_view_team(user) -> bool:
    """Nivel >= 2 — equivalente a `canViewTeam` legacy."""
    return role_level(user) >= 2


def get_subordinate_groups(user) -> list[Group]:
    """Grupos visibles para `user` EXCLUYENDO su propio grupo —
    equivalente a `getSubordinateRoles`/`VISIBLE_ROLES[role].filter(r =>
    r !== role)`."""
    own = get_role_group(user)
    return [g for g in get_visible_groups(user) if g != own]


# ── Ejecutor vs. liderazgo (Sprint 0A, ver docs/AUDIT_LOG.md §
# 2026-08-20, Fase 19) — DISTINTO de `is_leadership` (arriba,
# `role_level >= 3`): este concepto usa el umbral 4 (JEFE_NACIONAL/
# ADMINISTRADOR) y decide quién es sujeto de KPIs individuales de
# ejecución en vistas de equipo (`kpis/team`/`kpis/team-capacity`/
# `kpis/executive`), no visibilidad de proyectos. Mismo nombre
# conceptual que `is_leadership`, umbral y uso deliberadamente
# distintos — no confundir ni fusionar. Réplica de
# `isLeadershipRole`/`isExecutorRole` (`src/lib/roles.ts`).
def is_executor_group(group: Group | None) -> bool:
    """`ROLE_LEVEL < 4` — réplica de `isExecutorRole`. `None` (sin
    grupo) nunca es ejecutor, mismo criterio defensivo que `role_level`."""
    if group is None:
        return False
    return ROLE_LEVEL.get(group.name, 0) < 4


def get_subordinate_executor_groups(user) -> list[Group]:
    """Subordinados de `user` cuyo rol SÍ contempla ejecución de
    tareas — réplica de `getSubordinateRoles(role).filter(isExecutorRole)`,
    usado por las 3 rutas de Analytics de equipo (Fase 19)."""
    return [g for g in get_subordinate_groups(user) if is_executor_group(g)]


def can_manage_target_user(actor, target_user) -> bool:
    """Equivalente a `canManageTargetUser` legacy: el superusuario gestiona
    toda la jerarquía; el resto solo su propia jerarquía visible (lo que
    también excluye siempre al superusuario, que no aparece en ningún
    `RoleVisibility` sembrado)."""
    if actor.is_superuser:
        return True
    target_group = get_role_group(target_user)
    if target_group is None:
        return False
    return is_visible_to(actor, target_group)
