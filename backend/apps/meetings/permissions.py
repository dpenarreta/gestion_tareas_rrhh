"""Permisos de Reuniones — Fase 10 (ver docs/AUDIT_LOG.md §
2026-08-19). `can_create_meetings` migrado al catálogo dinámico de
permisos (`reuniones.crear`) — ver docs/AUDIT_LOG.md § 2026-09-01
("Catálogo dinámico de permisos extendido a todo el sistema"). El resto
de los permisos (ver/editar/eliminar una reunión puntual) depende del
objeto ya cargado (host/invitado) y vive inline en `views.py`, igual que
en las rutas legacy — no hay función de "visibilidad jerárquica"
involucrada en este módulo."""

from apps.permissions.authorization import user_has_permission


def can_create_meetings(user) -> bool:
    return user_has_permission(user, "reuniones.crear")
