"""Permisos de Escritorio Digital — Fases 7a-7b (ver docs/AUDIT_LOG.md §
2026-08-17). Réplica exacta de `canUseDeskNotes` (`src/lib/roles.ts`)."""

from rest_framework.permissions import IsAuthenticated

from .models import DeskNote, PersonalReminder


def role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR, igual que el
    resto del backend trata ese bypass (ver
    `apps.permissions.authorization.user_has_permission`)."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def can_use_desk_notes(user) -> bool:
    """Réplica de `canUseDeskNotes` — Escritorio Digital excluye
    deliberadamente al rol Administrador ("no es un participante
    operativo del día a día")."""
    return role_name(user) != "ADMINISTRADOR"


def can_access_desk_note(user, note: DeskNote) -> bool:
    """Ver el detalle/historial de una nota — cualquiera de los 2
    participantes."""
    return user.id == note.sender_id or user.id == note.recipient_id


class CanUseDeskNotes(IsAuthenticated):
    """`has_permission` — para listar/crear notas, y para las acciones
    de nivel de lista (`recipients`/`unread_count`)."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        return can_use_desk_notes(request.user)


class CanAccessDeskNote(CanUseDeskNotes):
    """Detalle/historial — ver `can_access_desk_note`."""

    def has_object_permission(self, request, view, obj: DeskNote) -> bool:
        return can_access_desk_note(request.user, obj)


class IsDeskNoteRecipient(CanUseDeskNotes):
    """Acciones que solo puede ejecutar quien recibió la nota
    (`read`/`pin`/`unpin`/`archive`/`unarchive`) — es su escritorio."""

    def has_object_permission(self, request, view, obj: DeskNote) -> bool:
        return request.user.id == obj.recipient_id


class IsReminderOwner(CanUseDeskNotes):
    """`PersonalReminder` — Fase 7b: sin remitente/destinatario, un
    solo dueño (`user`), exclusivo para todas las acciones."""

    def has_object_permission(self, request, view, obj: PersonalReminder) -> bool:
        return request.user.id == obj.user_id
