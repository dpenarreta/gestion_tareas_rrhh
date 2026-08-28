"""Lógica de negocio del módulo administrativo de usuarios.

Las vistas (controladores) delegan aquí — nunca acceden al ORM ni aplican
reglas de negocio directamente.
"""

from django.contrib.auth.models import Group, Permission
from rest_framework import serializers

from apps.authentication.services import AuthenticationService, SessionService
from apps.core.audit import record_audit_event

from .models import User

# AC-038: el sistema nunca debe quedar sin al menos un administrador activo
# (definido como `is_superuser=True` — el único bypass real de autorización,
# ver `apps.permissions.authorization.user_has_permission`). No existía en el
# proyecto original del que se particionó este skeleton; se construyó
# específicamente para este template base.
LAST_ACTIVE_ADMIN_ERROR = (
    "No es posible deshabilitar/bloquear a este usuario: es el único "
    "administrador activo del sistema."
)


class UserAdminService:
    """Toda operación queda auditada (`apps.core.audit.record_audit_event`) y
    las que deban invalidar sesiones activas (deshabilitar, bloquear) lo
    hacen a través de `status`, que ya dispara la señal existente
    `apps.users.signals.revoke_sessions_when_user_disabled`."""

    @staticmethod
    def create_user(
        *,
        actor: User,
        username: str,
        email: str,
        password: str,
        first_name: str = "",
        last_name: str = "",
        role_ids: list[int] | None = None,
        context: dict | None = None,
    ) -> User:
        user = AuthenticationService.register_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
        )
        user.created_by = actor
        user.updated_by = actor
        user.save(update_fields=["created_by", "updated_by"])

        if role_ids:
            user.groups.set(Group.objects.filter(id__in=role_ids))

        record_audit_event(
            actor=actor,
            action="user.created",
            target=user,
            module="usuarios",
            new_values={"username": username, "email": email, "role_ids": role_ids or []},
            context=context,
        )
        return user

    @staticmethod
    def update_user(*, actor: User, user: User, context: dict | None = None, **fields) -> User:
        previous_values = {}
        new_values = {}
        for field, value in fields.items():
            old = getattr(user, field)
            if old != value:
                previous_values[field] = old
                new_values[field] = value
                setattr(user, field, value)

        if new_values:
            user.updated_by = actor
            user.save(update_fields=[*new_values.keys(), "updated_by", "updated_at"])
            record_audit_event(
                actor=actor,
                action="user.updated",
                target=user,
                module="usuarios",
                previous_values=previous_values,
                new_values=new_values,
                context=context,
            )
        return user

    @staticmethod
    def _is_last_active_admin(user: User) -> bool:
        """AC-038: `user` es el único administrador (`is_superuser=True`)
        que sigue con `status=ACTIVE` en todo el sistema."""
        if not user.is_superuser:
            return False
        return not (
            User.objects.filter(is_superuser=True, status=User.Status.ACTIVE)
            .exclude(pk=user.pk)
            .exists()
        )

    @staticmethod
    def _set_status(
        *, actor: User, user: User, status: str, action: str, context: dict | None = None
    ) -> User:
        if status != User.Status.ACTIVE and UserAdminService._is_last_active_admin(user):
            raise serializers.ValidationError({"non_field_errors": [LAST_ACTIVE_ADMIN_ERROR]})

        previous_status = user.status
        user.status = status
        user.updated_by = actor
        user.save(update_fields=["status", "is_active", "updated_by", "updated_at"])
        record_audit_event(
            actor=actor,
            action=action,
            target=user,
            module="usuarios",
            previous_values={"status": previous_status},
            new_values={"status": status},
            context=context,
        )
        return user

    @staticmethod
    def enable(*, actor: User, user: User, context: dict | None = None) -> User:
        return UserAdminService._set_status(
            actor=actor,
            user=user,
            status=User.Status.ACTIVE,
            action="user.enabled",
            context=context,
        )

    @staticmethod
    def disable(*, actor: User, user: User, context: dict | None = None) -> User:
        return UserAdminService._set_status(
            actor=actor,
            user=user,
            status=User.Status.DISABLED,
            action="user.disabled",
            context=context,
        )

    @staticmethod
    def block(*, actor: User, user: User, context: dict | None = None) -> User:
        return UserAdminService._set_status(
            actor=actor,
            user=user,
            status=User.Status.BLOCKED,
            action="user.blocked",
            context=context,
        )

    @staticmethod
    def unblock(*, actor: User, user: User, context: dict | None = None) -> User:
        return UserAdminService._set_status(
            actor=actor,
            user=user,
            status=User.Status.ACTIVE,
            action="user.unblocked",
            context=context,
        )

    @staticmethod
    def revoke_sessions(*, actor: User, user: User, context: dict | None = None) -> int:
        revoked_count = SessionService.logout_all(user)
        record_audit_event(
            actor=actor,
            action="user.sessions_revoked",
            target=user,
            module="usuarios",
            new_values={"revoked_count": revoked_count},
            context=context,
        )
        return revoked_count

    @staticmethod
    def assign_roles(
        *, actor: User, user: User, role_ids: list[int], context: dict | None = None
    ) -> User:
        previous_groups = list(user.groups.all())
        groups = list(Group.objects.filter(id__in=role_ids))
        user.groups.set(groups)
        user.updated_by = actor
        user.save(update_fields=["updated_by", "updated_at"])
        record_audit_event(
            actor=actor,
            action="user.roles_assigned",
            target=user,
            module="usuarios",
            previous_values={
                "role_ids": [g.id for g in previous_groups],
                "role_names": [g.name for g in previous_groups],
            },
            new_values={"role_ids": role_ids, "role_names": [g.name for g in groups]},
            context=context,
        )
        return user

    @staticmethod
    def reset_consent(*, actor: User, user: User, context: dict | None = None) -> User:
        """Réplica de `PATCH /api/users/[id]/reset-consent` — Fase 13
        (ver docs/AUDIT_LOG.md § 2026-08-19). El TS no audita esta
        acción (no hay `AuditLog` en ese endpoint); se audita igual acá
        por consistencia con el resto de `UserAdminService` (política
        ya establecida: "Toda operación queda auditada")."""
        # `AuditLog.previous_values`/`new_values` son `JSONField` SIN
        # `encoder=DjangoJSONEncoder` (ver `apps.core.models.AuditLog`)
        # — un `datetime` crudo rompe la serialización a JSON del
        # driver mssql, así que se convierte a ISO string antes de
        # auditar.
        previous = {
            "data_consent_accepted": user.data_consent_accepted,
            "data_consent_accepted_at": user.data_consent_accepted_at.isoformat() if user.data_consent_accepted_at else None,
        }
        user.data_consent_accepted = False
        user.data_consent_accepted_at = None
        user.updated_by = actor
        user.save(update_fields=["data_consent_accepted", "data_consent_accepted_at", "updated_by", "updated_at"])
        record_audit_event(
            actor=actor,
            action="user.consent_reset",
            target=user,
            module="usuarios",
            previous_values=previous,
            new_values={"data_consent_accepted": False, "data_consent_accepted_at": None},
            context=context,
        )
        return user

    @staticmethod
    def reset_consent_all(*, actor: User, context: dict | None = None) -> int:
        """Réplica de `PATCH /api/users/reset-consent-all` — Fase 13
        (ver docs/AUDIT_LOG.md § 2026-08-19). `count` es TODAS las filas
        tocadas por el `updateMany` sin `where` del TS (no solo las que
        tenían el consentimiento en `true`), réplica fiel de esa
        semántica."""
        count = User.objects.all().update(data_consent_accepted=False, data_consent_accepted_at=None)
        record_audit_event(
            actor=actor,
            action="user.consent_reset_all",
            target=actor,
            module="usuarios",
            new_values={"count": count},
            context=context,
        )
        return count

    @staticmethod
    def assign_permissions(
        *, actor: User, user: User, permissions: list[Permission], context: dict | None = None
    ) -> User:
        previous_permissions = list(user.user_permissions.all())
        user.user_permissions.set(permissions)
        user.updated_by = actor
        user.save(update_fields=["updated_by", "updated_at"])
        record_audit_event(
            actor=actor,
            action="user.permissions_assigned",
            target=user,
            module="usuarios",
            previous_values={"permissions": [p.codename for p in previous_permissions]},
            new_values={"permissions": [p.codename for p in permissions]},
            context=context,
        )
        return user
