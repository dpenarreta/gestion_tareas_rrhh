"""Lógica de negocio del módulo administrativo de usuarios.

Las vistas (controladores) delegan aquí — nunca acceden al ORM ni aplican
reglas de negocio directamente.
"""

from django.contrib.auth.models import Group, Permission
from django.db import transaction
from django.db.models import ProtectedError
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
LAST_ACTIVE_ADMIN_ROLE_ERROR = (
    "No es posible quitarle el rol ADMINISTRADOR a este usuario: es el "
    "único administrador activo del sistema."
)

# Borrado definitivo (`UserAdminService.delete_permanently`). Existe por
# pedido explícito del usuario (2026-09-11) y convive con la baja lógica, que
# sigue siendo el camino normal — ver docs/AUDIT_LOG.md § 2026-09-11.
DELETE_SELF_ERROR = "No es posible eliminar tu propia cuenta."
DELETE_REQUIRES_DISABLED_ERROR = (
    "Solo se puede eliminar definitivamente una cuenta que ya esté "
    "deshabilitada. Primero deshabilitala y después eliminala."
)
DELETE_LAST_ACTIVE_ADMIN_ERROR = (
    "No es posible eliminar a este usuario: es el único administrador activo " "del sistema."
)
DELETE_PROTECTED_ERROR = (
    "No es posible eliminar a este usuario porque tiene información de "
    "trabajo asociada que se perdería ({detalle}). La cuenta puede quedar "
    "deshabilitada: no podrá iniciar sesión y su historial se conserva."
)

# Nombre legible de lo que impide un borrado, para que el mensaje de error
# diga "3 tareas" y no "3 Task". Solo los modelos con `on_delete=PROTECT`
# hacia User pueden aparecer acá.
_PROTECTED_LABELS = {
    "Task": "tareas",
    "Project": "proyectos",
    "ProjectParticipant": "participaciones en proyectos",
    "Meeting": "reuniones",
    "MeetingInvitee": "invitaciones a reuniones",
    "ImprovementIdea": "ideas de mejora",
    "IdeaVote": "votos en ideas",
    "IdeaStatusHistory": "cambios de estado de ideas",
    "Announcement": "anuncios",
    "MonthClosure": "cierres de mes",
    "SystemConfigHistory": "cambios de configuración",
}


def _describe_protected(protected_objects) -> str:
    conteo: dict[str, int] = {}
    for obj in protected_objects:
        nombre = type(obj).__name__
        conteo[nombre] = conteo.get(nombre, 0) + 1
    partes = [
        f"{cantidad} {_PROTECTED_LABELS.get(modelo, modelo)}"
        for modelo, cantidad in sorted(conteo.items())
    ]
    return ", ".join(partes)


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
            groups = list(Group.objects.filter(id__in=role_ids))
            user.groups.set(groups)
            UserAdminService._sync_superuser_with_administrador_group(user, groups)

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
    def _administrador_in(groups) -> bool:
        return any(g.name == "ADMINISTRADOR" for g in groups)

    @staticmethod
    def _sync_superuser_with_administrador_group(user: User, groups) -> None:
        """Hallazgo H-6 de la re-auditoría de datos personales (ver
        docs/AUDIT_LOG.md § 2026-09-02): `is_superuser` es el único
        bypass real de autorización (`user_has_permission`), y desde la
        migración 0004 de `apps.permissions`
        (`0004_seed_all_permissions_to_administrador`) el grupo
        ADMINISTRADOR ya tiene sembrado TODO el catálogo de permisos —
        pero ningún flujo del producto asignaba realmente
        `is_superuser`, dejando a cualquier Administrador creado por el
        camino normal sin poder gestionar `LeaveRecord`/`SpecialStatus`
        (Art. 26 LOPDP, gate `_is_true_superuser` desde H-5). Se
        mantiene sincronizado con la pertenencia al grupo en cada
        creación/reasignación de rol — nunca se asigna a mano en otro
        lado. El guard de "último administrador" vive en el llamador
        (`assign_roles`), antes de tocar los grupos, para no dejar un
        cambio a medias si se bloquea."""
        should_be_superuser = UserAdminService._administrador_in(groups)
        if user.is_superuser != should_be_superuser:
            user.is_superuser = should_be_superuser
            user.save(update_fields=["is_superuser"])

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
    def delete_permanently(*, actor: User, user: User, context: dict | None = None) -> None:
        """Borra la cuenta de la base de datos. Irreversible.

        La baja lógica (`disable`) sigue siendo el camino normal y lo que
        hace el botón principal de la lista: conserva el historial y se
        revierte. Esto existe para cuentas que no deberían haber existido —
        creadas por error, con el correo mal escrito, duplicadas — donde
        conservar el registro no aporta nada (pedido explícito del usuario,
        2026-09-11; ver docs/AUDIT_LOG.md § 2026-09-11).

        Tres guardas, en este orden:

        1. Nadie borra su propia cuenta.
        2. Solo se borra una cuenta ya deshabilitada. Es un borrado en dos
           pasos deliberado: obliga a que alguien la haya dado de baja antes,
           así un clic de más en la lista no puede destruir una cuenta en uso.
        3. Nunca el último administrador activo (misma invariante AC-038 que
           protege `_set_status`).

        Lo que el modelo ya garantiza y acá no se reimplementa: las FK con
        `on_delete=PROTECT` (tareas, proyectos, reuniones, ideas, anuncios,
        cierres de mes) hacen que Django rechace el borrado de cualquier
        cuenta con trabajo real asociado. Ese rechazo se traduce a un mensaje
        que dice qué lo impide, en vez de dejar salir un `ProtectedError`.

        Lo que SÍ se borra en cascada, y es el costo asumido de esta
        operación: sesiones, notificaciones, notas y recordatorios
        personales, registros de licencias y estados especiales (datos de
        salud, Art. 26 LOPDP) y solicitudes de derechos del titular. El
        `AuditLog` sobrevive: identifica al objeto por texto
        (`target_type`/`target_id`), no por FK, así que el registro de este
        borrado queda incluso después de que la cuenta deje de existir.
        """
        if actor.pk == user.pk:
            raise serializers.ValidationError({"non_field_errors": [DELETE_SELF_ERROR]})
        if user.status != User.Status.DISABLED:
            raise serializers.ValidationError(
                {"non_field_errors": [DELETE_REQUIRES_DISABLED_ERROR]}
            )
        if UserAdminService._is_last_active_admin(user):
            raise serializers.ValidationError(
                {"non_field_errors": [DELETE_LAST_ACTIVE_ADMIN_ERROR]}
            )

        # Los identificatorios se capturan ANTES de borrar: después de
        # `delete()` la instancia queda sin `pk` y el registro de auditoría
        # no podría decir a quién se borró.
        identificacion = {
            "id": user.pk,
            "username": user.username,
            "email": user.email,
            "roles": [group.name for group in user.groups.all()],
        }

        try:
            with transaction.atomic():
                # La auditoría se escribe dentro de la transacción: si el
                # borrado falla por PROTECT, el registro tampoco queda.
                record_audit_event(
                    actor=actor,
                    action="user.deleted",
                    target=user,
                    module="usuarios",
                    previous_values=identificacion,
                    new_values={},
                    context=context,
                )
                user.delete()
        except ProtectedError as exc:
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        DELETE_PROTECTED_ERROR.format(
                            detalle=_describe_protected(exc.protected_objects)
                        )
                    ]
                }
            ) from exc

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

        # Guard ANTES de tocar los grupos (ver AC-038): si esta
        # reasignación le quita ADMINISTRADOR al único administrador
        # activo del sistema, se bloquea sin dejar ningún cambio a
        # medias — mismo criterio que `_set_status` para
        # deshabilitar/bloquear.
        if not UserAdminService._administrador_in(
            groups
        ) and UserAdminService._is_last_active_admin(user):
            raise serializers.ValidationError({"non_field_errors": [LAST_ACTIVE_ADMIN_ROLE_ERROR]})

        previous_is_superuser = user.is_superuser
        user.groups.set(groups)
        UserAdminService._sync_superuser_with_administrador_group(user, groups)
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
                "is_superuser": previous_is_superuser,
            },
            new_values={
                "role_ids": role_ids,
                "role_names": [g.name for g in groups],
                "is_superuser": user.is_superuser,
            },
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
            "data_consent_accepted_at": (
                user.data_consent_accepted_at.isoformat() if user.data_consent_accepted_at else None
            ),
        }
        user.data_consent_accepted = False
        user.data_consent_accepted_at = None
        user.updated_by = actor
        user.save(
            update_fields=[
                "data_consent_accepted",
                "data_consent_accepted_at",
                "updated_by",
                "updated_at",
            ]
        )
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
        count = User.objects.all().update(
            data_consent_accepted=False, data_consent_accepted_at=None
        )
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
