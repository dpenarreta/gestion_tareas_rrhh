"""Permisos de Equipo — migrado al catálogo dinámico de permisos
(`equipo.ver`) — ver docs/AUDIT_LOG.md § 2026-09-01 ("Catálogo dinámico
de permisos extendido a todo el sistema"). Antes el gate vivía inline en
`views.py` (`can_view_team`, `apps.hierarchy.services`, réplica de
`canViewTeam` — nivel >= 2) — mismo comportamiento, ahora vía
`HasModulePermission` como el resto de los módulos migrados. Ambas vistas
son de solo lectura, sin `write_permission`."""

from apps.permissions.permissions import HasModulePermission


class TeamPermission(HasModulePermission):
    view_permission = "equipo.ver"
