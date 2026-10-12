"""Lógica de negocio del módulo Control Operativo de Novedades.

Toda autorización se recibe ya resuelta en un `NovedadesAccess` (ver
`access.py`) y se vuelve a comprobar aquí contra el registro concreto:
ocultar un botón en el frontend nunca es la barrera de seguridad.
"""

import logging
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.configuration.models import Holiday
from apps.core.audit import record_audit_event
from apps.core.models import AuditLog
from apps.notifications.services import notify_many
from apps.tasks.business_time import business_calendar_day

from . import access as perms
from .access import SUPERVISOR_ROLE, NovedadesAccess
from .models import (
    ClosedPeriodCorrection,
    Collaborator,
    CollaboratorAssignment,
    CollaboratorStatusChange,
    NovedadEvent,
    OperationalPeriod,
    OvertimeRecord,
    PendingNotification,
    PermissionOverride,
    SupervisorPeriod,
    WorkedDay,
)
from .periods import WEEKDAY_NAMES_ES, PeriodKey, is_weekend, period_for_date

logger = logging.getLogger("apps.novedades")
User = get_user_model()

MODULE = "novedades"
MAX_DAILY_HOURS = Decimal("24")


class NovedadesError(Exception):
    """Error de negocio con código, mensaje para el usuario y status HTTP.
    Las vistas lo traducen al contrato uniforme `{"error": {...}}`."""

    def __init__(self, message: str, *, code: str = "invalid", status: int = 400, details=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.details = details


def _forbidden(message: str = "No tiene permiso para realizar esta acción.") -> NovedadesError:
    return NovedadesError(message, code="permission_denied", status=403)


def _not_found(message: str) -> NovedadesError:
    return NovedadesError(message, code="not_found", status=404)


def user_display(user) -> str:
    if user is None:
        return ""
    full = user.get_full_name().strip() if hasattr(user, "get_full_name") else ""
    return full or user.username


def today() -> date:
    return business_calendar_day(timezone.now())


def parse_hours(value, *, field_label: str = "Horas") -> Decimal | None:
    """Número no negativo con hasta 2 decimales y máximo 24. Vacío -> None
    (nunca se convierte en cero)."""
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    if isinstance(value, bool):
        raise NovedadesError(f"{field_label}: valor inválido.")
    try:
        number = Decimal(str(value).strip().replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise NovedadesError(f"{field_label}: '{value}' no es un número válido.") from exc
    if not number.is_finite():
        raise NovedadesError(f"{field_label}: valor inválido.")
    if number < 0:
        raise NovedadesError(f"{field_label}: no se admiten valores negativos.")
    if number > MAX_DAILY_HOURS:
        raise NovedadesError(f"{field_label}: no puede superar {MAX_DAILY_HOURS} horas.")
    if number != number.quantize(Decimal("0.01")):
        raise NovedadesError(f"{field_label}: máximo 2 decimales.")
    return number.quantize(Decimal("0.01"))


def _fmt(value) -> str:
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return format(value.normalize(), "f") if value != value.to_integral() else str(int(value))
    if isinstance(value, bool):
        return "Sí" if value else "No"
    return str(value)


def normalize_cedula(value) -> str:
    text = str(value or "").strip().upper().replace(" ", "").replace("-", "")
    if text.endswith(".0"):  # cédula leída de Excel como número
        text = text[:-2]
    return text


# ── Historial y notificaciones ────────────────────────────────────────────────


class EventService:
    @staticmethod
    def log(
        *,
        actor,
        action: str,
        supervisor=None,
        period: OperationalPeriod | None = None,
        target_type: str = "",
        target_id="",
        target_label: str = "",
        field: str = "",
        old_value="",
        new_value="",
        reason: str = "",
        source_file: str = "",
        context: dict | None = None,
        audit: bool = True,
    ) -> NovedadEvent:
        role = perms.operational_role_of(actor) or (
            "ADMINISTRADOR" if getattr(actor, "is_superuser", False) else ""
        )
        event = NovedadEvent.objects.create(
            action=action,
            actor=actor,
            actor_role=role,
            supervisor=supervisor,
            period=period,
            target_type=target_type,
            target_id=str(target_id or ""),
            target_label=target_label[:255],
            field=field,
            old_value=_fmt(old_value)[:1000],
            new_value=_fmt(new_value)[:1000],
            reason=reason[:500],
            source_file=source_file[:255],
        )
        if audit:
            record_audit_event(
                actor=actor,
                action=f"novedades.{action}",
                target_type=target_type or "novedades",
                target_id=target_id or "",
                module=MODULE,
                previous_values={"field": field, "value": _fmt(old_value)} if field else None,
                new_values={
                    "field": field,
                    "value": _fmt(new_value),
                    "target": target_label,
                    "supervisor_id": getattr(supervisor, "pk", None),
                    "period": period.code if period else None,
                    "reason": reason,
                    "source_file": source_file,
                },
                context=context,
            )
        return event

    @staticmethod
    def log_cells(*, actor, supervisor, period, changes: list[dict], source_file: str = "") -> None:
        """Un evento por celda modificada (bulk) — el AuditLog general
        recibe un único resumen para no inundarlo en guardados masivos."""
        role = perms.operational_role_of(actor) or ("ADMINISTRADOR" if actor.is_superuser else "")
        NovedadEvent.objects.bulk_create(
            [
                NovedadEvent(
                    action=(
                        "worked_day.updated" if change["old"] is not None else "worked_day.created"
                    ),
                    actor=actor,
                    actor_role=role,
                    supervisor=supervisor,
                    period=period,
                    target_type="worked_day",
                    target_id=str(change["id"]),
                    target_label=change["label"][:255],
                    field=change["date"].isoformat(),
                    old_value=_fmt(change["old"]),
                    new_value=_fmt(change["new"]),
                    source_file=source_file[:255],
                )
                for change in changes
            ]
        )


class NotificationService:
    """Avisos al Administrador del módulo, reutilizando `apps.notifications`.
    Se envían DESPUÉS de confirmar la transacción de la operación: si el
    envío falla, la operación no se revierte ni se repite — queda un
    `PendingNotification` que reintenta `novedades_retry_notifications`."""

    @staticmethod
    def admin_recipients():
        return (
            User.objects.filter(is_active=True)
            .filter(
                Q(is_superuser=True)
                | Q(groups__permissions__codename=perms.ADMINISTRAR)
                | Q(user_permissions__codename=perms.ADMINISTRAR)
            )
            .exclude(groups__name__in=perms.OPERATIONAL_ROLES)
            .distinct()
        )

    @staticmethod
    def notify_admins(message: str, *, exclude_user=None) -> None:
        def _send():
            recipients = list(NotificationService.admin_recipients())
            if exclude_user is not None:
                recipients = [u for u in recipients if u.pk != exclude_user.pk]
            if not recipients:
                return
            try:
                notify_many(users=recipients, message=message)
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "No se pudo notificar al Administrador; queda pendiente de reintento"
                )
                PendingNotification.objects.create(
                    message=message,
                    recipient_ids=[u.pk for u in recipients],
                    attempts=1,
                    last_error=str(exc)[:500],
                )

        transaction.on_commit(_send)

    @staticmethod
    def retry_pending(max_attempts: int = 10) -> dict:
        delivered = failed = 0
        pending = PendingNotification.objects.filter(
            delivered_at__isnull=True, attempts__lt=max_attempts
        )
        for item in pending:
            try:
                notify_many(
                    users=User.objects.filter(pk__in=item.recipient_ids), message=item.message
                )
                item.delivered_at = timezone.now()
                delivered += 1
            except Exception as exc:  # noqa: BLE001
                item.last_error = str(exc)[:500]
                failed += 1
            item.attempts += 1
            item.save(update_fields=["delivered_at", "last_error", "attempts"])
        return {"delivered": delivered, "failed": failed}


# ── Períodos y cierres ────────────────────────────────────────────────────────


class PeriodService:
    @staticmethod
    def get_period(key: PeriodKey) -> OperationalPeriod:
        period, _ = OperationalPeriod.objects.get_or_create(
            year=key.year,
            month=key.month,
            defaults={"start_date": key.start_date, "end_date": key.end_date},
        )
        return period

    @staticmethod
    def supervisors():
        return User.objects.filter(groups__name=SUPERVISOR_ROLE, is_active=True).order_by(
            "first_name", "last_name", "username"
        )

    @staticmethod
    def get_supervisor(supervisor_id) -> "User":
        supervisor = User.objects.filter(pk=supervisor_id, groups__name=SUPERVISOR_ROLE).first()
        if supervisor is None:
            raise _not_found(
                "El supervisor indicado no existe o no tiene el rol Supervisor de Operaciones."
            )
        return supervisor

    @staticmethod
    def ensure_current(supervisor) -> SupervisorPeriod:
        """Período abierto más antiguo del supervisor; si nunca trabajó en el
        módulo, abre el período que contiene la fecha de hoy."""
        current = (
            SupervisorPeriod.objects.filter(
                supervisor=supervisor, status=SupervisorPeriod.Status.OPEN
            )
            .select_related("period")
            .order_by("period__year", "period__month")
            .first()
        )
        if current is not None:
            return current
        if SupervisorPeriod.objects.filter(supervisor=supervisor).exists():
            # Todos cerrados (no debería pasar: cerrar abre el siguiente).
            last = (
                SupervisorPeriod.objects.filter(supervisor=supervisor)
                .select_related("period")
                .order_by("-period__year", "-period__month")
                .first()
            )
            key = last.period.key.next()
        else:
            key = period_for_date(today())
        period = PeriodService.get_period(key)
        current, _ = SupervisorPeriod.objects.get_or_create(period=period, supervisor=supervisor)
        return current

    @staticmethod
    def supervisor_period(key: PeriodKey, supervisor) -> SupervisorPeriod | None:
        return (
            SupervisorPeriod.objects.filter(
                period__year=key.year, period__month=key.month, supervisor=supervisor
            )
            .select_related("period", "closed_by")
            .first()
        )

    @staticmethod
    def assert_open_for(supervisor, day: date) -> SupervisorPeriod:
        key = period_for_date(day)
        PeriodService.ensure_current(supervisor)
        sp = PeriodService.supervisor_period(key, supervisor)
        if sp is None:
            raise NovedadesError(
                f"El período {key.label} no está habilitado para {user_display(supervisor)}.",
                code="period_not_open",
            )
        if sp.status == SupervisorPeriod.Status.CLOSED:
            raise NovedadesError(
                f"El período {key.label} ya fue cerrado para {user_display(supervisor)}: "
                "los cambios requieren una corrección autorizada.",
                code="period_closed",
                status=409,
            )
        return sp

    @staticmethod
    def close_summary(acc: NovedadesAccess, key: PeriodKey, supervisor) -> dict:
        if not acc.can_read_supervisor(supervisor.pk):
            raise _forbidden()
        period = PeriodService.get_period(key)
        collaborators = Collaborator.objects.filter(
            Q(
                current_supervisor=supervisor,
                status__in=[Collaborator.Status.ACTIVE, Collaborator.Status.SUSPENDED],
            )
            | Q(worked_days__period=period, worked_days__supervisor=supervisor)
        ).distinct()
        active_ids = set(
            collaborators.filter(status=Collaborator.Status.ACTIVE).values_list("pk", flat=True)
        )
        workdays = [d for d in key.dates() if not is_weekend(d)]
        days = WorkedDay.objects.filter(period=period, supervisor=supervisor)
        filled = days.filter(hours__isnull=False)
        filled_keys = set(filled.values_list("collaborator_id", "date"))
        pending = sum(1 for cid in active_ids for d in workdays if (cid, d) not in filled_keys)
        overtime = OvertimeRecord.objects.filter(
            period=period, supervisor=supervisor, deleted_at__isnull=True
        )
        totals = overtime.aggregate(extra=Sum("overtime_hours"), saturday=Sum("saturday_hours"))
        return {
            "period": key.code,
            "period_label": key.label,
            "supervisor_id": supervisor.pk,
            "supervisor_name": user_display(supervisor),
            "collaborators": collaborators.count(),
            "active_collaborators": len(active_ids),
            "worked_day_cells": filled.count(),
            "zero_cells": filled.filter(hours=0).count(),
            "pending_cells": pending,
            "worked_hours": _fmt(filled.aggregate(total=Sum("hours"))["total"] or Decimal("0")),
            "overtime_records": overtime.count(),
            "overtime_hours": _fmt(totals["extra"] or Decimal("0")),
            "saturday_hours": _fmt(totals["saturday"] or Decimal("0")),
        }

    @staticmethod
    def close(acc: NovedadesAccess, key: PeriodKey, supervisor, *, context=None) -> dict:
        if not acc.can(perms.CERRAR):
            raise _forbidden("No tiene habilitado el cierre de períodos.")
        if not acc.can_write_for_supervisor(supervisor.pk):
            raise _forbidden()
        current = PeriodService.ensure_current(supervisor)
        sp = PeriodService.supervisor_period(key, supervisor)
        if sp is not None and sp.status == SupervisorPeriod.Status.CLOSED:
            # Idempotente: repetir el cierre no crea nada nuevo.
            nxt = PeriodService.supervisor_period(key.next(), supervisor)
            return {
                "already_closed": True,
                "period": key.code,
                "closed_at": sp.closed_at,
                "closed_by": user_display(sp.closed_by),
                "next_period": key.next().code if nxt else None,
                "summary": sp.summary,
            }
        if sp is None or sp.pk != current.pk:
            raise NovedadesError(
                f"Solo puede cerrarse el período abierto más antiguo ({current.period.key.label}).",
                code="wrong_period",
                status=409,
            )
        summary = PeriodService.close_summary(acc, key, supervisor)
        with transaction.atomic():
            sp = SupervisorPeriod.objects.select_for_update().get(pk=sp.pk)
            if sp.status == SupervisorPeriod.Status.CLOSED:
                return {"already_closed": True, "period": key.code, "summary": sp.summary}
            sp.status = SupervisorPeriod.Status.CLOSED
            sp.closed_at = timezone.now()
            sp.closed_by = acc.user
            sp.summary = summary
            sp.save(update_fields=["status", "closed_at", "closed_by", "summary"])
            next_period = PeriodService.get_period(key.next())
            SupervisorPeriod.objects.get_or_create(period=next_period, supervisor=supervisor)
            EventService.log(
                actor=acc.user,
                action="period.closed",
                supervisor=supervisor,
                period=sp.period,
                target_type="supervisor_period",
                target_id=sp.pk,
                target_label=f"{key.label} — {user_display(supervisor)}",
                new_value="CERRADO",
                context=context,
            )
            NotificationService.notify_admins(
                f"Cierre de período: {user_display(supervisor)} cerró {key.label} "
                f"({summary['active_collaborators']} colaboradores activos, "
                f"{summary['overtime_records']} registros de horas extras, "
                f"{summary['pending_cells']} celdas pendientes en Días laborados). "
                f"Se habilitó {key.next().label}.",
                exclude_user=acc.user,
            )
        return {
            "already_closed": False,
            "period": key.code,
            "closed_at": sp.closed_at,
            "closed_by": user_display(acc.user),
            "next_period": key.next().code,
            "summary": summary,
        }

    @staticmethod
    def status_overview(acc: NovedadesAccess, key: PeriodKey) -> list[dict]:
        supervisors = PeriodService.supervisors()
        ids = acc.readable_supervisor_ids()
        if ids is not None:
            supervisors = supervisors.filter(pk__in=ids)
        statuses = {
            sp.supervisor_id: sp
            for sp in SupervisorPeriod.objects.filter(
                period__year=key.year, period__month=key.month
            ).select_related("closed_by")
        }
        rows = []
        for supervisor in supervisors:
            sp = statuses.get(supervisor.pk)
            rows.append(
                {
                    "supervisor_id": supervisor.pk,
                    "supervisor_name": user_display(supervisor),
                    "status": sp.status if sp else "NOT_STARTED",
                    "closed_at": sp.closed_at if sp else None,
                    "closed_by": user_display(sp.closed_by) if sp and sp.closed_by else "",
                    "collaborators": Collaborator.objects.filter(current_supervisor=supervisor)
                    .exclude(status=Collaborator.Status.INACTIVE)
                    .count(),
                }
            )
        return rows

    @staticmethod
    def periods_for(acc: NovedadesAccess, supervisor=None) -> list[dict]:
        """Períodos disponibles para el selector: los que tienen estado para el
        supervisor (o, a nivel nacional, cualquiera), más el actual."""
        current_key = period_for_date(today())
        PeriodService.get_period(current_key)
        qs = SupervisorPeriod.objects.select_related("period")
        if supervisor is not None:
            qs = qs.filter(supervisor=supervisor)
        else:
            ids = acc.readable_supervisor_ids()
            if ids is not None:
                qs = qs.filter(supervisor_id__in=ids)
        keys = {sp.period.key for sp in qs}
        keys.add(current_key)
        status_by_key = {}
        if supervisor is not None:
            status_by_key = {sp.period.key: sp.status for sp in qs}
        return [
            {
                "code": k.code,
                "label": k.label,
                "start_date": k.start_date,
                "end_date": k.end_date,
                "status": status_by_key.get(k),
            }
            for k in sorted(keys, key=lambda k: (k.year, k.month), reverse=True)
        ]


# ── Colaboradores ─────────────────────────────────────────────────────────────


@dataclass
class CollaboratorInput:
    cedula: str
    full_name: str
    regional: str = ""
    area: str = ""
    cargo: str = ""


class CollaboratorService:
    @staticmethod
    def queryset_for(acc: NovedadesAccess):
        qs = Collaborator.objects.select_related("current_supervisor")
        ids = acc.readable_supervisor_ids()
        if ids is not None:
            qs = qs.filter(current_supervisor_id__in=ids)
        return qs

    @staticmethod
    def get_for_read(acc: NovedadesAccess, collaborator_id) -> Collaborator:
        collaborator = CollaboratorService.queryset_for(acc).filter(pk=collaborator_id).first()
        if collaborator is None:
            raise _not_found("Colaborador no encontrado.")
        return collaborator

    @staticmethod
    def _get_for_write(acc: NovedadesAccess, collaborator_id) -> Collaborator:
        if not acc.can(perms.COLABORADORES):
            raise _forbidden("No tiene permiso para gestionar colaboradores.")
        collaborator = (
            Collaborator.objects.select_related("current_supervisor")
            .filter(pk=collaborator_id)
            .first()
        )
        if collaborator is None or not acc.can_write_for_supervisor(
            collaborator.current_supervisor_id
        ):
            raise _not_found("Colaborador no encontrado en su base.")
        return collaborator

    @staticmethod
    def create(
        acc: NovedadesAccess, data: CollaboratorInput, *, supervisor_id=None, context=None
    ) -> Collaborator:
        if not acc.can(perms.COLABORADORES):
            raise _forbidden("No tiene permiso para registrar colaboradores.")
        if acc.is_supervisor and not acc.national_write:
            supervisor_id = acc.user.pk
        if supervisor_id is None:
            raise NovedadesError("Indique el supervisor responsable del colaborador.")
        supervisor = PeriodService.get_supervisor(supervisor_id)
        if not acc.can_write_for_supervisor(supervisor.pk):
            raise _forbidden()

        cedula = normalize_cedula(data.cedula)
        if not cedula or len(cedula) < 6 or not cedula.isalnum():
            raise NovedadesError("Cédula inválida.", details={"cedula": ["Cédula inválida."]})
        full_name = data.full_name.strip()
        if not full_name:
            raise NovedadesError(
                "El nombre es obligatorio.", details={"full_name": ["Obligatorio."]}
            )

        existing = (
            Collaborator.objects.select_related("current_supervisor").filter(cedula=cedula).first()
        )
        if existing is not None:
            if existing.current_supervisor_id == supervisor.pk:
                raise NovedadesError(
                    f"{existing.full_name} ({cedula}) ya está registrado en esta base.",
                    code="duplicate",
                    status=409,
                    details={"collaborator_id": existing.pk},
                )
            EventService.log(
                actor=acc.user,
                action="collaborator.assignment_conflict",
                supervisor=supervisor,
                target_type="collaborator",
                target_id=existing.pk,
                target_label=f"{existing.full_name} ({cedula})",
                new_value=user_display(supervisor),
                old_value=user_display(existing.current_supervisor),
                context=context,
            )
            NotificationService.notify_admins(
                f"Reasignación solicitada: {user_display(supervisor)} intentó registrar a "
                f"{existing.full_name} (cédula {cedula}), que pertenece a la base de "
                f"{user_display(existing.current_supervisor)}. Gestione la reasignación si corresponde."
            )
            raise NovedadesError(
                f"La cédula {cedula} ya pertenece a la base de otro supervisor. "
                "Se notificó al Administrador para que gestione la reasignación.",
                code="assigned_to_other",
                status=409,
            )

        with transaction.atomic():
            collaborator = Collaborator.objects.create(
                cedula=cedula,
                full_name=full_name,
                regional=data.regional.strip(),
                area=data.area.strip(),
                cargo=data.cargo.strip(),
                current_supervisor=supervisor,
                created_by=acc.user,
            )
            CollaboratorAssignment.objects.create(
                collaborator=collaborator,
                supervisor=supervisor,
                assigned_by=acc.user,
                reason="Alta",
            )
            current = PeriodService.ensure_current(supervisor)
            EventService.log(
                actor=acc.user,
                action="collaborator.created",
                supervisor=supervisor,
                period=current.period,
                target_type="collaborator",
                target_id=collaborator.pk,
                target_label=f"{full_name} ({cedula})",
                new_value="ACTIVO",
                context=context,
            )
            registered_at = timezone.localtime().strftime("%d/%m/%Y %H:%M")
            NotificationService.notify_admins(
                f"Nuevo colaborador operativo: {full_name} — cédula {cedula} — cargo "
                f"{collaborator.cargo or 's/d'} — área {collaborator.area or 's/d'} — regional "
                f"{collaborator.regional or 's/d'}. Supervisor: {user_display(supervisor)}. "
                f"Registrado el {registered_at} (período {current.period.key.label}).",
                exclude_user=acc.user,
            )
        return collaborator

    @staticmethod
    def update(
        acc: NovedadesAccess, collaborator_id, changes: dict, *, context=None
    ) -> Collaborator:
        collaborator = CollaboratorService._get_for_write(acc, collaborator_id)
        editable = ("full_name", "regional", "area", "cargo")
        with transaction.atomic():
            for field in editable:
                if field not in changes:
                    continue
                new = str(changes[field] or "").strip()
                if field == "full_name" and not new:
                    raise NovedadesError("El nombre es obligatorio.")
                old = getattr(collaborator, field)
                if old == new:
                    continue
                setattr(collaborator, field, new)
                EventService.log(
                    actor=acc.user,
                    action="collaborator.updated",
                    supervisor=collaborator.current_supervisor,
                    target_type="collaborator",
                    target_id=collaborator.pk,
                    target_label=f"{collaborator.full_name} ({collaborator.cedula})",
                    field=field,
                    old_value=old,
                    new_value=new,
                    context=context,
                )
            collaborator.save()
        return collaborator

    @staticmethod
    def change_status(
        acc: NovedadesAccess, collaborator_id, new_status: str, reason: str, *, context=None
    ):
        collaborator = CollaboratorService._get_for_write(acc, collaborator_id)
        if new_status not in Collaborator.Status.values:
            raise NovedadesError("Estado inválido.")
        reason = (reason or "").strip()
        if new_status != Collaborator.Status.ACTIVE and not reason:
            raise NovedadesError(
                "Indique el motivo del cambio de estado.", details={"reason": ["Obligatorio."]}
            )
        previous = collaborator.status
        if previous == new_status:
            return collaborator
        labels = dict(Collaborator.Status.choices)
        with transaction.atomic():
            collaborator.status = new_status
            collaborator.save(update_fields=["status", "updated_at"])
            CollaboratorStatusChange.objects.create(
                collaborator=collaborator,
                previous_status=previous,
                new_status=new_status,
                changed_by=acc.user,
                reason=reason,
            )
            EventService.log(
                actor=acc.user,
                action="collaborator.status_changed",
                supervisor=collaborator.current_supervisor,
                target_type="collaborator",
                target_id=collaborator.pk,
                target_label=f"{collaborator.full_name} ({collaborator.cedula})",
                field="status",
                old_value=labels[previous],
                new_value=labels[new_status],
                reason=reason,
                context=context,
            )
            if new_status in (Collaborator.Status.INACTIVE, Collaborator.Status.SUSPENDED):
                changed_at = timezone.localtime().strftime("%d/%m/%Y %H:%M")
                NotificationService.notify_admins(
                    f"Cambio de estado: {collaborator.full_name} (cédula {collaborator.cedula}) pasó de "
                    f"{labels[previous]} a {labels[new_status]}. Supervisor: "
                    f"{user_display(collaborator.current_supervisor)}. Fecha: {changed_at}. Motivo: {reason}.",
                    exclude_user=acc.user,
                )
        return collaborator

    @staticmethod
    def reassign(
        acc: NovedadesAccess, collaborator_id, new_supervisor_id, reason: str, *, context=None
    ):
        if not acc.national_write:
            raise _forbidden("Solo el Administrador puede reasignar colaboradores.")
        reason = (reason or "").strip()
        if not reason:
            raise NovedadesError("Indique el motivo de la reasignación.")
        collaborator = (
            Collaborator.objects.select_related("current_supervisor")
            .filter(pk=collaborator_id)
            .first()
        )
        if collaborator is None:
            raise _not_found("Colaborador no encontrado.")
        new_supervisor = PeriodService.get_supervisor(new_supervisor_id)
        if collaborator.current_supervisor_id == new_supervisor.pk:
            return collaborator
        previous = collaborator.current_supervisor
        with transaction.atomic():
            CollaboratorAssignment.objects.filter(
                collaborator=collaborator, ended_at__isnull=True
            ).update(ended_at=timezone.now())
            CollaboratorAssignment.objects.create(
                collaborator=collaborator,
                supervisor=new_supervisor,
                assigned_by=acc.user,
                reason=reason,
            )
            collaborator.current_supervisor = new_supervisor
            collaborator.save(update_fields=["current_supervisor", "updated_at"])
            PeriodService.ensure_current(new_supervisor)
            EventService.log(
                actor=acc.user,
                action="collaborator.reassigned",
                supervisor=new_supervisor,
                target_type="collaborator",
                target_id=collaborator.pk,
                target_label=f"{collaborator.full_name} ({collaborator.cedula})",
                field="supervisor",
                old_value=user_display(previous),
                new_value=user_display(new_supervisor),
                reason=reason,
                context=context,
            )
        return collaborator

    @staticmethod
    def history(acc: NovedadesAccess, collaborator_id) -> dict:
        collaborator = CollaboratorService.get_for_read(acc, collaborator_id)
        return {
            "statuses": [
                {
                    "previous_status": c.previous_status,
                    "new_status": c.new_status,
                    "changed_by": user_display(c.changed_by),
                    "reason": c.reason,
                    "created_at": c.created_at,
                }
                for c in collaborator.status_changes.select_related("changed_by")
            ],
            "assignments": [
                {
                    "supervisor": user_display(a.supervisor),
                    "started_at": a.started_at,
                    "ended_at": a.ended_at,
                    "assigned_by": user_display(a.assigned_by),
                    "reason": a.reason,
                }
                for a in collaborator.assignments.select_related("supervisor", "assigned_by")
            ],
        }


# ── Días laborados ────────────────────────────────────────────────────────────


class WorkedDayService:
    @staticmethod
    def _holidays(key: PeriodKey) -> dict[date, str]:
        return dict(
            Holiday.objects.filter(date__gte=key.start_date, date__lte=key.end_date).values_list(
                "date", "name"
            )
        )

    @staticmethod
    def matrix(acc: NovedadesAccess, key: PeriodKey, supervisor) -> dict:
        if not acc.can(perms.ACCEDER):
            raise _forbidden()
        if not acc.can_read_supervisor(supervisor.pk):
            raise _forbidden("No puede consultar el equipo de otro supervisor.")
        PeriodService.ensure_current(supervisor)
        period = PeriodService.get_period(key)
        sp = PeriodService.supervisor_period(key, supervisor)
        is_open = sp is not None and sp.status == SupervisorPeriod.Status.OPEN
        editable = (
            is_open and acc.can(perms.REGISTRAR) and acc.can_write_for_supervisor(supervisor.pk)
        )

        collaborators = list(
            Collaborator.objects.filter(
                Q(
                    current_supervisor=supervisor,
                    status__in=[Collaborator.Status.ACTIVE, Collaborator.Status.SUSPENDED],
                )
                | Q(worked_days__period=period, worked_days__supervisor=supervisor)
            )
            .distinct()
            .order_by("full_name")
        )
        cells = {}
        for wd in WorkedDay.objects.filter(period=period, collaborator__in=collaborators):
            cells.setdefault(wd.collaborator_id, {})[wd.date.isoformat()] = {
                "hours": _fmt(wd.hours) if wd.hours is not None else None,
                "version": wd.version,
            }
        holidays = WorkedDayService._holidays(key)
        columns = [
            {
                "date": d.isoformat(),
                "day": d.day,
                "weekday": WEEKDAY_NAMES_ES[d.weekday()],
                "is_weekend": is_weekend(d),
                "holiday": holidays.get(d, ""),
            }
            for d in key.dates()
        ]
        rows = []
        for c in collaborators:
            row_cells = cells.get(c.pk, {})
            total = sum(
                (Decimal(v["hours"]) for v in row_cells.values() if v["hours"] is not None),
                Decimal("0"),
            )
            rows.append(
                {
                    "collaborator_id": c.pk,
                    "cedula": c.cedula,
                    "full_name": c.full_name,
                    "cargo": c.cargo,
                    "area": c.area,
                    "regional": c.regional,
                    "status": c.status,
                    "is_current_member": c.current_supervisor_id == supervisor.pk,
                    "cells": row_cells,
                    "total_hours": _fmt(total),
                }
            )
        return {
            "period": {
                "code": key.code,
                "label": key.label,
                "start_date": key.start_date,
                "end_date": key.end_date,
                "status": sp.status if sp else "NOT_STARTED",
                "closed_at": sp.closed_at if sp else None,
                "closed_by": user_display(sp.closed_by) if sp and sp.closed_by else "",
            },
            "supervisor": {"id": supervisor.pk, "name": user_display(supervisor)},
            "editable": editable,
            "columns": columns,
            "rows": rows,
        }

    @staticmethod
    def validate_cell(
        collaborator: Collaborator, day: date, key: PeriodKey, hours
    ) -> Decimal | None:
        if not key.contains(day):
            raise NovedadesError(f"La fecha {day:%d/%m/%Y} no pertenece al período {key.label}.")
        if is_weekend(day):
            raise NovedadesError(
                f"{day:%d/%m/%Y} es {WEEKDAY_NAMES_ES[day.weekday()].lower()}: las columnas de sábado y "
                "domingo no admiten registros en Días laborados.",
                code="weekend_locked",
            )
        value = parse_hours(hours, field_label=f"{collaborator.full_name} {day:%d/%m}")
        if value is not None and collaborator.status != Collaborator.Status.ACTIVE:
            raise NovedadesError(
                f"{collaborator.full_name} está {collaborator.get_status_display().lower()}: "
                "no admite nuevos registros.",
                code="collaborator_not_active",
            )
        return value

    @staticmethod
    def save_cells(
        acc: NovedadesAccess,
        key: PeriodKey,
        supervisor,
        cells: list[dict],
        *,
        source_file: str = "",
        context=None,
        notify: bool = True,
    ) -> dict:
        if not acc.can(perms.REGISTRAR):
            raise _forbidden("No tiene habilitado el registro de novedades.")
        if not acc.can_write_for_supervisor(supervisor.pk):
            raise _forbidden("Solo puede registrar información de su propio equipo.")
        PeriodService.ensure_current(supervisor)
        sp = PeriodService.supervisor_period(key, supervisor)
        if sp is None:
            raise NovedadesError(
                f"El período {key.label} no está habilitado.", code="period_not_open"
            )
        if sp.status == SupervisorPeriod.Status.CLOSED:
            raise NovedadesError(
                f"El período {key.label} está cerrado: no admite edición ordinaria.",
                code="period_closed",
                status=409,
            )
        period = sp.period

        ids = {int(c["collaborator_id"]) for c in cells}
        collaborators = {c.pk: c for c in Collaborator.objects.filter(pk__in=ids)}
        existing = {
            (wd.collaborator_id, wd.date): wd
            for wd in WorkedDay.objects.filter(period=period, collaborator_id__in=ids)
        }
        errors, conflicts, plan = [], [], []
        for cell in cells:
            cid = int(cell["collaborator_id"])
            day = cell["date"]
            collaborator = collaborators.get(cid)
            current = existing.get((cid, day))
            owner_ok = collaborator is not None and (
                collaborator.current_supervisor_id == supervisor.pk
                or (current is not None and current.supervisor_id == supervisor.pk)
            )
            if not owner_ok:
                errors.append(
                    {
                        "collaborator_id": cid,
                        "date": day,
                        "message": "Colaborador fuera de su equipo.",
                    }
                )
                continue
            try:
                value = WorkedDayService.validate_cell(collaborator, day, key, cell.get("hours"))
            except NovedadesError as exc:
                if (
                    exc.code == "collaborator_not_active"
                    and current is not None
                    and current.hours is not None
                ):
                    # Sí se permite vaciar/corregir lo ya registrado antes del cambio de estado.
                    value = parse_hours(cell.get("hours"))
                else:
                    errors.append(
                        {
                            "collaborator_id": cid,
                            "date": day,
                            "message": exc.message,
                            "code": exc.code,
                        }
                    )
                    continue
            expected_version = cell.get("version")
            if (
                current is not None
                and expected_version is not None
                and int(expected_version) != current.version
            ):
                conflicts.append(
                    {
                        "collaborator_id": cid,
                        "date": day,
                        "message": f"{collaborator.full_name} {day:%d/%m}: otro usuario modificó esta celda.",
                        "current_hours": _fmt(current.hours) if current.hours is not None else None,
                        "current_version": current.version,
                    }
                )
                continue
            old = current.hours if current is not None else None
            if current is None and value is None:
                continue
            if current is not None and current.hours == value:
                continue
            plan.append((collaborator, day, current, old, value))

        if errors:
            if any(e.get("code") == "weekend_locked" for e in errors):
                # Un sábado/domingo solo llega acá saltándose la interfaz
                # (que bloquea esas celdas): se deja constancia.
                record_audit_event(
                    actor=acc.user,
                    action="novedades.worked_days.weekend_rejected",
                    target_type="supervisor_period",
                    target_id=sp.pk,
                    module=MODULE,
                    new_values={"period": key.code, "supervisor_id": supervisor.pk},
                    result=AuditLog.Result.FAILURE,
                    context=context,
                )
            raise NovedadesError(
                "Hay celdas con errores; no se guardó ningún cambio.", details={"cells": errors}
            )
        if conflicts:
            raise NovedadesError(
                "Otro usuario modificó algunas celdas mientras editaba; recargue para ver los valores actuales.",
                code="conflict",
                status=409,
                details={"cells": conflicts},
            )

        changes = []
        with transaction.atomic():
            for collaborator, day, current, old, value in plan:
                if current is None:
                    current = WorkedDay.objects.create(
                        collaborator=collaborator,
                        period=period,
                        supervisor=supervisor,
                        date=day,
                        hours=value,
                        updated_by=acc.user,
                    )
                else:
                    updated = WorkedDay.objects.filter(
                        pk=current.pk, version=current.version
                    ).update(
                        hours=value,
                        version=current.version + 1,
                        updated_by=acc.user,
                        updated_at=timezone.now(),
                    )
                    if not updated:
                        raise NovedadesError(
                            "Otro usuario modificó la información mientras se guardaba; recargue e intente de nuevo.",
                            code="conflict",
                            status=409,
                        )
                changes.append(
                    {
                        "id": current.pk,
                        "label": f"{collaborator.full_name} ({collaborator.cedula})",
                        "date": day,
                        "old": old,
                        "new": value,
                    }
                )
            if changes:
                EventService.log_cells(
                    actor=acc.user,
                    supervisor=supervisor,
                    period=period,
                    changes=changes,
                    source_file=source_file,
                )
                record_audit_event(
                    actor=acc.user,
                    action="novedades.worked_days.saved",
                    target_type="supervisor_period",
                    target_id=sp.pk,
                    module=MODULE,
                    new_values={
                        "period": key.code,
                        "supervisor_id": supervisor.pk,
                        "changed_cells": len(changes),
                        "source_file": source_file,
                    },
                    context=context,
                )
                if notify:
                    NotificationService.notify_admins(
                        f"Días laborados: {user_display(acc.user)} registró {len(changes)} cambio(s) "
                        f"en el equipo de {user_display(supervisor)} — {key.label}.",
                        exclude_user=acc.user,
                    )
        return {"saved": len(changes)}


# ── Horas extras ──────────────────────────────────────────────────────────────

OVERTIME_FIELDS = (
    "overtime_hours",
    "saturday_hours",
    "is_saturday",
    "is_sunday",
    "is_holiday",
    "work_done",
    "observations",
)


class OvertimeService:
    @staticmethod
    def queryset_for(acc: NovedadesAccess):
        if not acc.can(perms.ACCEDER):
            raise _forbidden()
        if acc.is_assistant and not acc.can(perms.CONSOLIDADO):
            raise _forbidden("No tiene habilitada la consulta del consolidado.")
        qs = OvertimeRecord.objects.filter(deleted_at__isnull=True).select_related(
            "collaborator", "supervisor", "period", "created_by", "updated_by"
        )
        ids = acc.readable_supervisor_ids()
        if ids is not None:
            qs = qs.filter(supervisor_id__in=ids)
        return qs

    @staticmethod
    def filter(qs, params: dict):
        if params.get("period"):
            key = params["period"]
            qs = qs.filter(period__year=key.year, period__month=key.month)
        if params.get("date"):
            qs = qs.filter(date=params["date"])
        if params.get("date_from"):
            qs = qs.filter(date__gte=params["date_from"])
        if params.get("date_to"):
            qs = qs.filter(date__lte=params["date_to"])
        if params.get("cedula"):
            qs = qs.filter(collaborator__cedula__icontains=normalize_cedula(params["cedula"]))
        if params.get("name"):
            qs = qs.filter(collaborator__full_name__icontains=params["name"].strip())
        for field in ("regional", "area", "cargo"):
            if params.get(field):
                qs = qs.filter(**{f"collaborator__{field}__icontains": params[field].strip()})
        if params.get("supervisor"):
            qs = qs.filter(supervisor_id=params["supervisor"])
        jornada = {"sabado": "is_saturday", "domingo": "is_sunday", "feriado": "is_holiday"}.get(
            params.get("jornada") or ""
        )
        if jornada:
            qs = qs.filter(**{jornada: True})
        return qs.order_by("date", "collaborator__full_name", "pk")

    @staticmethod
    def indicators(qs) -> dict:
        totals = qs.aggregate(
            records=Count("pk"),
            extra=Sum("overtime_hours"),
            saturday=Sum("saturday_hours"),
            supervisors=Count("supervisor", distinct=True),
            collaborators=Count("collaborator", distinct=True),
        )
        return {
            "records": totals["records"] or 0,
            "overtime_hours": _fmt(totals["extra"] or Decimal("0")),
            "saturday_hours": _fmt(totals["saturday"] or Decimal("0")),
            "supervisors_reporting": totals["supervisors"] or 0,
            "collaborators_with_records": totals["collaborators"] or 0,
        }

    @staticmethod
    def row_values(data: dict, day: date, *, is_holiday_day: bool | None = None):
        """Validación de UNA novedad, campo por campo. Devuelve
        `(valores, errores)` donde `errores` es `{campo: mensaje}` — la misma
        regla para el formulario individual, el guardado masivo y la
        importación. `# HORAS EXTRAS` y `# HORAS SABADO` son campos
        independientes: nunca se suman ni se copian uno al otro."""
        errors: dict[str, str] = {}
        hours = {}
        for field, label in (
            ("overtime_hours", "# Horas extras"),
            ("saturday_hours", "# Horas sábado"),
        ):
            try:
                hours[field] = parse_hours(data.get(field), field_label=label) or Decimal("0")
            except NovedadesError as exc:
                errors[field] = exc.message
        if not errors and hours["overtime_hours"] + hours["saturday_hours"] <= 0:
            errors["overtime_hours"] = "Registre al menos una hora extra o una hora de sábado."
        work_done = str(data.get("work_done") or "").strip()
        observations = str(data.get("observations") or "").strip()
        if len(work_done) > 500:
            errors["work_done"] = "Máximo 500 caracteres."
        if len(observations) > 1000:
            errors["observations"] = "Máximo 1000 caracteres."
        for flag in ("is_saturday", "is_sunday", "is_holiday"):
            if data.get(flag) is not None and not isinstance(data.get(flag), bool):
                errors[flag] = "Valor inválido: use Sí o No."
        if errors:
            return None, errors
        if is_holiday_day is None:
            is_holiday_day = Holiday.objects.filter(date=day).exists()

        def flag(name, default):
            return bool(data[name]) if data.get(name) is not None else default

        return {
            "overtime_hours": hours["overtime_hours"],
            "saturday_hours": hours["saturday_hours"],
            "is_saturday": flag("is_saturday", day.weekday() == 5),
            "is_sunday": flag("is_sunday", day.weekday() == 6),
            "is_holiday": flag("is_holiday", is_holiday_day),
            "work_done": work_done,
            "observations": observations,
        }, {}

    @staticmethod
    def _clean_values(data: dict, day: date) -> dict:
        values, errors = OvertimeService.row_values(data, day)
        if errors:
            raise NovedadesError(next(iter(errors.values())), details={"fields": errors})
        return values

    @staticmethod
    def create(
        acc: NovedadesAccess, data: dict, *, source_file: str = "", context=None, notify=True
    ) -> OvertimeRecord:
        if not acc.can(perms.REGISTRAR):
            raise _forbidden("No tiene habilitado el registro de novedades.")
        collaborator = (
            Collaborator.objects.select_related("current_supervisor")
            .filter(pk=data.get("collaborator_id"))
            .first()
        )
        if collaborator is None or not acc.can_write_for_supervisor(
            collaborator.current_supervisor_id
        ):
            raise _not_found("Colaborador no encontrado en su base.")
        if collaborator.status != Collaborator.Status.ACTIVE:
            raise NovedadesError(
                f"{collaborator.full_name} está {collaborator.get_status_display().lower()}: no admite nuevas novedades.",
                code="collaborator_not_active",
            )
        day = data["date"]
        supervisor = collaborator.current_supervisor
        sp = PeriodService.assert_open_for(supervisor, day)
        values = OvertimeService._clean_values(data, day)
        duplicate = OvertimeRecord.objects.filter(
            collaborator=collaborator, date=day, deleted_at__isnull=True
        ).first()
        if duplicate is not None:
            raise NovedadesError(
                f"Ya existe un registro de horas extras de {collaborator.full_name} el {day:%d/%m/%Y}; edítelo en "
                "lugar de crear uno nuevo.",
                code="duplicate",
                status=409,
                details={"record_id": duplicate.pk},
            )
        with transaction.atomic():
            record = OvertimeRecord.objects.create(
                collaborator=collaborator,
                period=sp.period,
                supervisor=supervisor,
                date=day,
                created_by=acc.user,
                updated_by=acc.user,
                **values,
            )
            EventService.log(
                actor=acc.user,
                action="overtime.created",
                supervisor=supervisor,
                period=sp.period,
                target_type="overtime",
                target_id=record.pk,
                target_label=f"{collaborator.full_name} ({collaborator.cedula}) {day:%d/%m/%Y}",
                new_value=f"{_fmt(values['overtime_hours'])} h extra / {_fmt(values['saturday_hours'])} h sábado",
                source_file=source_file,
                context=context,
            )
            if notify:
                NotificationService.notify_admins(
                    f"Horas extras: {user_display(acc.user)} registró {_fmt(values['overtime_hours'])} h extra y "
                    f"{_fmt(values['saturday_hours'])} h de sábado para {collaborator.full_name} "
                    f"({collaborator.cedula}) el {day:%d/%m/%Y} — {sp.period.key.label}.",
                    exclude_user=acc.user,
                )
        return record

    @staticmethod
    def _get_for_write(acc: NovedadesAccess, record_id) -> OvertimeRecord:
        if not acc.can(perms.REGISTRAR):
            raise _forbidden("No tiene habilitado el registro de novedades.")
        record = (
            OvertimeRecord.objects.select_related("collaborator", "supervisor", "period")
            .filter(pk=record_id, deleted_at__isnull=True)
            .first()
        )
        if record is None or not acc.can_write_for_supervisor(record.supervisor_id):
            raise _not_found("Registro no encontrado.")
        return record

    @staticmethod
    def update(
        acc: NovedadesAccess, record_id, data: dict, *, source_file="", context=None, notify=True
    ):
        record = OvertimeService._get_for_write(acc, record_id)
        version = data.get("version")
        if version is not None and int(version) != record.version:
            raise NovedadesError(
                "Otro usuario modificó este registro; recargue para ver la versión actual.",
                code="conflict",
                status=409,
            )
        PeriodService.assert_open_for(record.supervisor, record.date)
        merged = {f: getattr(record, f) for f in OVERTIME_FIELDS}
        merged.update({k: v for k, v in data.items() if k in OVERTIME_FIELDS})
        values = OvertimeService._clean_values(merged, record.date)
        changed = {f: (getattr(record, f), v) for f, v in values.items() if getattr(record, f) != v}
        if not changed:
            return record
        with transaction.atomic():
            updated = OvertimeRecord.objects.filter(pk=record.pk, version=record.version).update(
                **values, version=record.version + 1, updated_by=acc.user, updated_at=timezone.now()
            )
            if not updated:
                raise NovedadesError(
                    "Otro usuario modificó este registro; recargue.", code="conflict", status=409
                )
            label = f"{record.collaborator.full_name} ({record.collaborator.cedula}) {record.date:%d/%m/%Y}"
            for field, (old, new) in changed.items():
                EventService.log(
                    actor=acc.user,
                    action="overtime.updated",
                    supervisor=record.supervisor,
                    period=record.period,
                    target_type="overtime",
                    target_id=record.pk,
                    target_label=label,
                    field=field,
                    old_value=old,
                    new_value=new,
                    source_file=source_file,
                    context=context,
                )
            if notify:
                NotificationService.notify_admins(
                    f"Horas extras: {user_display(acc.user)} modificó el registro de {label} "
                    f"({', '.join(changed)}).",
                    exclude_user=acc.user,
                )
        record.refresh_from_db()
        return record

    @staticmethod
    def delete(acc: NovedadesAccess, record_id, reason: str = "", *, context=None) -> None:
        record = OvertimeService._get_for_write(acc, record_id)
        PeriodService.assert_open_for(record.supervisor, record.date)
        label = (
            f"{record.collaborator.full_name} ({record.collaborator.cedula}) {record.date:%d/%m/%Y}"
        )
        with transaction.atomic():
            record.deleted_at = timezone.now()
            record.deleted_by = acc.user
            record.save(update_fields=["deleted_at", "deleted_by"])
            EventService.log(
                actor=acc.user,
                action="overtime.deleted",
                supervisor=record.supervisor,
                period=record.period,
                target_type="overtime",
                target_id=record.pk,
                target_label=label,
                old_value=f"{_fmt(record.overtime_hours)} h extra / {_fmt(record.saturday_hours)} h sábado",
                reason=reason,
                context=context,
            )
            NotificationService.notify_admins(
                f"Horas extras: {user_display(acc.user)} eliminó el registro de {label}"
                + (f". Motivo: {reason}." if reason else "."),
                exclude_user=acc.user,
            )

    BULK_LIMIT = 500

    @staticmethod
    def bulk_save(
        acc: NovedadesAccess,
        key: PeriodKey,
        rows: list[dict],
        *,
        source_file: str = "",
        context=None,
        notify: bool = True,
    ) -> dict:
        """Guardado masivo de la captura tipo Excel de Horas extras.

        Comportamiento declarado (y cubierto por tests): primero se valida
        TODO el lote; después se guarda cada fila válida en su propia
        transacción y se devuelve el resultado fila por fila. Una fila con
        error nunca se guarda y nunca impide guardar las demás.

        Cada fila es una creación (sin `id`) o una actualización (`id` +
        `version`). Reintentar el mismo lote no duplica nada: una fila nueva
        cuyo (colaborador, fecha) ya existe con exactamente los mismos
        valores, creada por el mismo usuario, se informa como "ya guardada"
        con su id — es el caso de un doble clic o de una respuesta perdida
        por la red. Si los valores difieren, es un duplicado real.

        Nunca se confía en datos de identidad del navegador: cédula, nombre,
        regional, área, cargo y supervisor salen de la base; del cliente
        solo se toman el id del colaborador, la fecha y los valores
        capturados."""
        if not acc.can(perms.REGISTRAR) or acc.is_assistant:
            raise _forbidden("No tiene habilitado el registro de novedades.")
        if not rows:
            raise NovedadesError("No hay filas para guardar.")
        if len(rows) > OvertimeService.BULK_LIMIT:
            raise NovedadesError(
                f"El lote tiene {len(rows)} filas y el máximo es {OvertimeService.BULK_LIMIT}. "
                "Guárdelo en partes: las filas no guardadas se conservan en la tabla.",
                code="batch_too_large",
            )

        collaborator_ids = {r.get("collaborator_id") for r in rows if r.get("collaborator_id")}
        collaborators = {
            c.pk: c
            for c in Collaborator.objects.select_related("current_supervisor").filter(
                pk__in=collaborator_ids
            )
        }
        record_ids = {r["id"] for r in rows if r.get("id")}
        by_id = {
            r.pk: r
            for r in OvertimeRecord.objects.select_related(
                "collaborator", "supervisor", "period"
            ).filter(pk__in=record_ids, deleted_at__isnull=True)
        }
        existing_by_key = {
            (r.collaborator_id, r.date): r
            for r in OvertimeRecord.objects.filter(
                collaborator_id__in=collaborator_ids,
                date__gte=key.start_date,
                date__lte=key.end_date,
                deleted_at__isnull=True,
            )
        }
        holidays = set(
            Holiday.objects.filter(date__gte=key.start_date, date__lte=key.end_date).values_list(
                "date", flat=True
            )
        )
        supervisor_ids = {c.current_supervisor_id for c in collaborators.values()} | {
            r.supervisor_id for r in by_id.values()
        }
        for sid in supervisor_ids:
            PeriodService.ensure_current(User.objects.get(pk=sid))
        open_supervisors = set(
            SupervisorPeriod.objects.filter(
                period__year=key.year,
                period__month=key.month,
                supervisor_id__in=supervisor_ids,
                status=SupervisorPeriod.Status.OPEN,
            ).values_list("supervisor_id", flat=True)
        )
        period = PeriodService.get_period(key)

        results: list[dict] = []
        plan: list[tuple[int, dict]] = []
        seen_keys: dict[tuple, str] = {}

        def fail(row, status, errors):
            results.append(
                {
                    "client_key": row.get("client_key"),
                    "status": status,
                    "errors": errors,
                    "record_id": row.get("id"),
                }
            )

        for row in rows:
            client_key = row.get("client_key")
            day = row.get("date")
            record = by_id.get(row["id"]) if row.get("id") else None
            if row.get("id") and record is None:
                fail(
                    row,
                    "error",
                    {"row": "El registro ya no existe (fue eliminado); recargue la tabla."},
                )
                continue
            if record is not None and not key.contains(record.date):
                fail(
                    row,
                    "error",
                    {"date": f"El registro pertenece a otro período, no a {key.label}."},
                )
                continue
            collaborator = (
                record.collaborator if record else collaborators.get(row.get("collaborator_id"))
            )
            if collaborator is None:
                fail(row, "error", {"collaborator": "Colaborador no encontrado."})
                continue
            supervisor_id = record.supervisor_id if record else collaborator.current_supervisor_id
            if not acc.can_write_for_supervisor(supervisor_id):
                fail(row, "locked", {"collaborator": "El colaborador no pertenece a su equipo."})
                continue
            if day is None:
                fail(row, "error", {"date": "La fecha es obligatoria."})
                continue
            if not key.contains(day):
                fail(row, "error", {"date": f"La fecha no pertenece al período {key.label}."})
                continue
            if supervisor_id not in open_supervisors:
                fail(
                    row,
                    "locked",
                    {
                        "row": f"{key.label} está cerrado para este equipo: no admite cambios ordinarios."
                    },
                )
                continue
            if record is None and collaborator.status != Collaborator.Status.ACTIVE:
                fail(
                    row,
                    "error",
                    {
                        "collaborator": f"{collaborator.full_name} está {collaborator.get_status_display().lower()}."
                    },
                )
                continue
            values, errors = OvertimeService.row_values(row, day, is_holiday_day=day in holidays)
            if errors:
                fail(row, "error", errors)
                continue
            dup_key = (collaborator.pk, day)
            if dup_key in seen_keys:
                fail(
                    row,
                    "duplicate",
                    {"date": "La misma persona y fecha está dos veces en la tabla."},
                )
                continue
            seen_keys[dup_key] = client_key
            other = existing_by_key.get(dup_key)
            if record is not None:
                if row.get("version") is not None and int(row["version"]) != record.version:
                    fail(
                        row,
                        "conflict",
                        {"row": "Otro usuario modificó este registro; recargue la tabla."},
                    )
                    continue
                if other is not None and other.pk != record.pk:
                    fail(
                        row,
                        "duplicate",
                        {"date": "Ya existe otro registro de esta persona en esa fecha."},
                    )
                    continue
            elif other is not None:
                same = other.created_by_id == acc.user.pk and all(
                    getattr(other, f) == v for f, v in values.items()
                )
                if same:
                    # Reintento de una fila que ya se guardó: no se duplica.
                    results.append(
                        {
                            "client_key": client_key,
                            "status": "unchanged",
                            "errors": {},
                            "record_id": other.pk,
                            "version": other.version,
                        }
                    )
                    continue
                fail(
                    row,
                    "duplicate",
                    {
                        "date": f"Ya existe un registro de {collaborator.full_name} el {day:%d/%m/%Y}; edítelo en lugar de crear otro."
                    },
                )
                continue
            plan.append(
                (
                    len(results),
                    {"row": row, "record": record, "collaborator": collaborator, "values": values},
                )
            )
            results.append({"client_key": client_key, "status": "pending", "errors": {}})

        created = updated = unchanged = 0
        events = []
        for index, item in plan:
            row, record, collaborator, values = (
                item["row"],
                item["record"],
                item["collaborator"],
                item["values"],
            )
            day = row["date"]
            label = f"{collaborator.full_name} ({collaborator.cedula}) {day:%d/%m/%Y}"
            try:
                with transaction.atomic():
                    if record is None:
                        new = OvertimeRecord.objects.create(
                            collaborator=collaborator,
                            period=period,
                            supervisor=collaborator.current_supervisor,
                            date=day,
                            created_by=acc.user,
                            updated_by=acc.user,
                            **values,
                        )
                        events.append(
                            (
                                "overtime.created",
                                collaborator.current_supervisor_id,
                                new.pk,
                                label,
                                "",
                                "",
                                "",
                            )
                        )
                        results[index] = {
                            "client_key": row.get("client_key"),
                            "status": "created",
                            "errors": {},
                            "record_id": new.pk,
                            "version": new.version,
                        }
                        created += 1
                        continue
                    changes = {
                        f: (getattr(record, f), v)
                        for f, v in values.items()
                        if getattr(record, f) != v
                    }
                    if record.date != day:
                        changes["date"] = (record.date, day)
                    if not changes:
                        results[index] = {
                            "client_key": row.get("client_key"),
                            "status": "unchanged",
                            "errors": {},
                            "record_id": record.pk,
                            "version": record.version,
                        }
                        unchanged += 1
                        continue
                    count = OvertimeRecord.objects.filter(
                        pk=record.pk, version=record.version
                    ).update(
                        **values,
                        date=day,
                        version=record.version + 1,
                        updated_by=acc.user,
                        updated_at=timezone.now(),
                    )
                    if not count:
                        raise NovedadesError(
                            "Otro usuario modificó este registro; recargue la tabla.",
                            code="conflict",
                        )
                    for field, (old, new_value) in changes.items():
                        events.append(
                            (
                                "overtime.updated",
                                record.supervisor_id,
                                record.pk,
                                label,
                                field,
                                old,
                                new_value,
                            )
                        )
                    results[index] = {
                        "client_key": row.get("client_key"),
                        "status": "updated",
                        "errors": {},
                        "record_id": record.pk,
                        "version": record.version + 1,
                    }
                    updated += 1
            except NovedadesError as exc:
                results[index] = {
                    "client_key": row.get("client_key"),
                    "status": "conflict",
                    "errors": {"row": exc.message},
                }
            except IntegrityError:
                # Otra petición guardó la misma persona y fecha entre la
                # validación y la escritura: la restricción de la base lo frena.
                results[index] = {
                    "client_key": row.get("client_key"),
                    "status": "duplicate",
                    "errors": {
                        "date": "Se registró en paralelo otra novedad de esta persona en esa fecha; recargue."
                    },
                }

        role = perms.operational_role_of(acc.user) or (
            "ADMINISTRADOR" if acc.user.is_superuser else ""
        )
        NovedadEvent.objects.bulk_create(
            [
                NovedadEvent(
                    action=action,
                    actor=acc.user,
                    actor_role=role,
                    supervisor_id=sid,
                    period=period,
                    target_type="overtime",
                    target_id=str(rid),
                    target_label=label[:255],
                    field=field,
                    old_value=_fmt(old)[:1000],
                    new_value=_fmt(new)[:1000],
                    source_file=source_file[:255],
                )
                for action, sid, rid, label, field, old, new in events
            ]
        )
        summary = {
            "created": created,
            "updated": updated,
            "unchanged": sum(1 for r in results if r["status"] == "unchanged"),
            "errors": sum(
                1 for r in results if r["status"] in ("error", "duplicate", "conflict", "locked")
            ),
            "total": len(rows),
        }
        if created or updated:
            record_audit_event(
                actor=acc.user,
                action="novedades.overtime.bulk_saved",
                target_type="overtime_batch",
                target_id=period.code,
                module=MODULE,
                new_values={**summary, "period": key.code, "source_file": source_file},
                context=context,
            )
            if notify:
                NotificationService.notify_admins(
                    f"Horas extras: {user_display(acc.user)} guardó un lote en {key.label} — "
                    f"{created} nuevo(s), {updated} modificado(s)"
                    + (f", {summary['errors']} con error" if summary["errors"] else "")
                    + (f" (importación {source_file})" if source_file else "")
                    + ".",
                    exclude_user=acc.user,
                )
        return {"summary": summary, "rows": results}


# ── Correcciones de períodos cerrados ─────────────────────────────────────────


class CorrectionService:
    @staticmethod
    def _check(acc: NovedadesAccess, reason: str):
        if not acc.can(perms.CORREGIR) or not acc.national_write:
            raise _forbidden(
                "Las correcciones de períodos cerrados requieren autorización del Administrador."
            )
        if not (reason or "").strip():
            raise NovedadesError(
                "Indique el motivo de la corrección.", details={"reason": ["Obligatorio."]}
            )

    @staticmethod
    def _closed_sp(supervisor, day: date) -> SupervisorPeriod:
        key = period_for_date(day)
        sp = PeriodService.supervisor_period(key, supervisor)
        if sp is None or sp.status != SupervisorPeriod.Status.CLOSED:
            raise NovedadesError(
                f"{key.label} no está cerrado para {user_display(supervisor)}: use la edición ordinaria.",
                code="period_open",
                status=409,
            )
        return sp

    @staticmethod
    def correct_worked_day(
        acc, *, collaborator_id, supervisor_id, day: date, hours, reason: str, context=None
    ):
        CorrectionService._check(acc, reason)
        supervisor = PeriodService.get_supervisor(supervisor_id)
        collaborator = Collaborator.objects.filter(pk=collaborator_id).first()
        if collaborator is None:
            raise _not_found("Colaborador no encontrado.")
        sp = CorrectionService._closed_sp(supervisor, day)
        if is_weekend(day):
            raise NovedadesError(
                "Sábados y domingos no admiten registros en Días laborados.", code="weekend_locked"
            )
        value = parse_hours(hours)
        with transaction.atomic():
            wd = WorkedDay.objects.filter(collaborator=collaborator, date=day).first()
            original = {"hours": _fmt(wd.hours) if wd and wd.hours is not None else None}
            if wd is None:
                if value is None:
                    raise NovedadesError("La celda ya está vacía.")
                wd = WorkedDay.objects.create(
                    collaborator=collaborator,
                    period=sp.period,
                    supervisor=supervisor,
                    date=day,
                    hours=value,
                    updated_by=acc.user,
                )
            else:
                wd.hours = value
                wd.version += 1
                wd.updated_by = acc.user
                wd.save(update_fields=["hours", "version", "updated_by", "updated_at"])
            correction = ClosedPeriodCorrection.objects.create(
                target=ClosedPeriodCorrection.Target.WORKED_DAY,
                target_id=wd.pk,
                period=sp.period,
                supervisor=supervisor,
                original_values=original,
                new_values={"hours": _fmt(value) if value is not None else None},
                reason=reason.strip(),
                corrected_by=acc.user,
            )
            EventService.log(
                actor=acc.user,
                action="correction.worked_day",
                supervisor=supervisor,
                period=sp.period,
                target_type="worked_day",
                target_id=wd.pk,
                target_label=f"{collaborator.full_name} ({collaborator.cedula})",
                field=day.isoformat(),
                old_value=original["hours"] or "",
                new_value=value,
                reason=reason.strip(),
                context=context,
            )
        return correction

    @staticmethod
    def correct_overtime(acc, *, record_id, changes: dict, delete: bool, reason: str, context=None):
        CorrectionService._check(acc, reason)
        record = (
            OvertimeRecord.objects.select_related("collaborator", "supervisor")
            .filter(pk=record_id, deleted_at__isnull=True)
            .first()
        )
        if record is None:
            raise _not_found("Registro no encontrado.")
        sp = CorrectionService._closed_sp(record.supervisor, record.date)
        original = {f: _fmt(getattr(record, f)) for f in OVERTIME_FIELDS}
        with transaction.atomic():
            if delete:
                record.deleted_at = timezone.now()
                record.deleted_by = acc.user
                record.save(update_fields=["deleted_at", "deleted_by"])
                new_values = {"deleted": True}
            else:
                merged = {f: getattr(record, f) for f in OVERTIME_FIELDS}
                merged.update({k: v for k, v in changes.items() if k in OVERTIME_FIELDS})
                values = OvertimeService._clean_values(merged, record.date)
                for f, v in values.items():
                    setattr(record, f, v)
                record.version += 1
                record.updated_by = acc.user
                record.save()
                new_values = {f: _fmt(v) for f, v in values.items()}
            correction = ClosedPeriodCorrection.objects.create(
                target=ClosedPeriodCorrection.Target.OVERTIME,
                target_id=record.pk,
                period=sp.period,
                supervisor=record.supervisor,
                original_values=original,
                new_values=new_values,
                reason=reason.strip(),
                corrected_by=acc.user,
            )
            EventService.log(
                actor=acc.user,
                action="correction.overtime",
                supervisor=record.supervisor,
                period=sp.period,
                target_type="overtime",
                target_id=record.pk,
                target_label=f"{record.collaborator.full_name} ({record.collaborator.cedula}) {record.date:%d/%m/%Y}",
                old_value=str(original),
                new_value=str(new_values),
                reason=reason.strip(),
                context=context,
            )
        return correction


# ── Historial y repositorio ───────────────────────────────────────────────────


class HistoryService:
    PERMISSION_ACTIONS = (
        "permission.role_changed",
        "permission.override_created",
        "permission.override_revoked",
    )

    @staticmethod
    def events(acc: NovedadesAccess, params: dict):
        if not acc.can(perms.HISTORIAL):
            raise _forbidden("No tiene habilitada la consulta del historial.")
        qs = NovedadEvent.objects.select_related("actor", "supervisor", "period")
        ids = acc.readable_supervisor_ids()
        if ids is not None:
            qs = qs.filter(supervisor_id__in=ids)
        if not acc.can(perms.PERMISOS):
            qs = qs.exclude(action__in=HistoryService.PERMISSION_ACTIONS)
        if params.get("kind") == "permissions":
            qs = qs.filter(action__in=HistoryService.PERMISSION_ACTIONS)
        if params.get("period"):
            key = params["period"]
            qs = qs.filter(period__year=key.year, period__month=key.month)
        if params.get("supervisor"):
            qs = qs.filter(supervisor_id=params["supervisor"])
        if params.get("action"):
            qs = qs.filter(action__startswith=params["action"])
        if params.get("q"):
            qs = qs.filter(target_label__icontains=params["q"].strip())
        if params.get("date_from"):
            qs = qs.filter(created_at__date__gte=params["date_from"])
        if params.get("date_to"):
            qs = qs.filter(created_at__date__lte=params["date_to"])
        return qs

    @staticmethod
    def repository(acc: NovedadesAccess) -> list[dict]:
        if not acc.can(perms.HISTORIAL):
            raise _forbidden("No tiene habilitada la consulta del repositorio.")
        sps = SupervisorPeriod.objects.select_related("period", "supervisor", "closed_by")
        ids = acc.readable_supervisor_ids()
        if ids is not None:
            sps = sps.filter(supervisor_id__in=ids)
        corrections = ClosedPeriodCorrection.objects.select_related(
            "corrected_by", "supervisor", "period"
        )
        if ids is not None:
            corrections = corrections.filter(supervisor_id__in=ids)
        by_period: dict[tuple, dict] = {}
        for sp in sps:
            key = sp.period.key
            entry = by_period.setdefault(
                (key.year, key.month),
                {
                    "code": key.code,
                    "label": key.label,
                    "start_date": key.start_date,
                    "end_date": key.end_date,
                    "supervisors": [],
                    "corrections": [],
                },
            )
            entry["supervisors"].append(
                {
                    "supervisor_id": sp.supervisor_id,
                    "supervisor_name": user_display(sp.supervisor),
                    "status": sp.status,
                    "closed_at": sp.closed_at,
                    "closed_by": user_display(sp.closed_by) if sp.closed_by else "",
                    "summary": sp.summary,
                }
            )
        for c in corrections:
            key = c.period.key
            entry = by_period.get((key.year, key.month))
            if entry is None:
                continue
            entry["corrections"].append(
                {
                    "id": c.pk,
                    "target": c.target,
                    "supervisor_name": user_display(c.supervisor),
                    "original_values": c.original_values,
                    "new_values": c.new_values,
                    "reason": c.reason,
                    "corrected_by": user_display(c.corrected_by),
                    "created_at": c.created_at,
                }
            )
        return [by_period[k] for k in sorted(by_period, reverse=True)]


# ── Administración de permisos del módulo ─────────────────────────────────────


class PermissionAdminService:
    @staticmethod
    def _check(acc: NovedadesAccess):
        if not acc.can(perms.PERMISOS):
            raise _forbidden("No tiene permiso para administrar los permisos del módulo.")

    @staticmethod
    def config(acc: NovedadesAccess) -> dict:
        from django.contrib.auth.models import Group

        from apps.permissions.catalog import PERMISSION_CATALOG

        PermissionAdminService._check(acc)
        labels = PERMISSION_CATALOG["novedades"]["permissions"]
        roles = []
        for role in perms.OPERATIONAL_ROLES:
            group = Group.objects.filter(name=role).first()
            enabled = set(group.permissions.values_list("codename", flat=True)) if group else set()
            last = (
                NovedadEvent.objects.filter(action="permission.role_changed", target_id=role)
                .select_related("actor")
                .first()
            )
            roles.append(
                {
                    "role": role,
                    "permissions": [
                        {
                            "codename": codename,
                            "label": labels[codename],
                            "state": state,
                            "enabled": state == "mandatory"
                            or (state == "configurable" and codename in enabled),
                        }
                        for codename, state in perms.ROLE_MATRIX[role].items()
                    ],
                    "last_change": (
                        {
                            "by": user_display(last.actor),
                            "at": last.created_at,
                            "detail": last.new_value,
                        }
                        if last
                        else None
                    ),
                }
            )
        return {"roles": roles}

    @staticmethod
    def set_role_permission(
        acc: NovedadesAccess, *, role: str, codename: str, enabled: bool, reason: str, context=None
    ):
        from django.contrib.auth.models import Group, Permission

        PermissionAdminService._check(acc)
        if not perms.is_configurable(role, codename):
            raise NovedadesError(
                "Ese permiso no es configurable para el rol indicado.", code="not_configurable"
            )
        if acc.role == role:
            raise _forbidden("No puede modificar los permisos de su propio rol.")
        group = Group.objects.filter(name=role).first()
        permission = Permission.objects.filter(
            content_type__app_label="permissions",
            content_type__model="modulepermission",
            codename=codename,
        ).first()
        if group is None or permission is None:
            raise _not_found("Rol o permiso no encontrado.")
        before = group.permissions.filter(pk=permission.pk).exists()
        if before == enabled:
            return
        with transaction.atomic():
            if enabled:
                group.permissions.add(permission)
            else:
                group.permissions.remove(permission)
            EventService.log(
                actor=acc.user,
                action="permission.role_changed",
                target_type="role",
                target_id=role,
                target_label=role,
                field=codename,
                old_value="Habilitado" if before else "Deshabilitado",
                new_value="Habilitado" if enabled else "Deshabilitado",
                reason=(reason or "").strip(),
                context=context,
            )

    @staticmethod
    def operational_users(acc: NovedadesAccess) -> list[dict]:
        PermissionAdminService._check(acc)
        users = (
            User.objects.filter(groups__name__in=perms.OPERATIONAL_ROLES)
            .prefetch_related("groups")
            .order_by("first_name", "last_name", "username")
            .distinct()
        )
        return [
            {
                "id": u.pk,
                "name": user_display(u),
                "email": u.email,
                "role": perms.operational_role_of(u),
                "is_active": u.is_active,
            }
            for u in users
        ]

    @staticmethod
    def effective(acc: NovedadesAccess, user_id) -> dict:
        PermissionAdminService._check(acc)
        target = User.objects.filter(pk=user_id).first()
        if target is None:
            raise _not_found("Usuario no encontrado.")
        target_access = NovedadesAccess.for_user(target)
        overrides = PermissionOverride.objects.filter(user=target).select_related(
            "created_by", "revoked_by"
        )
        return {
            "user": {"id": target.pk, "name": user_display(target), "role": target_access.role},
            "effective": target_access.as_dict(),
            "overrides": [PermissionAdminService.serialize_override(o) for o in overrides],
        }

    @staticmethod
    def serialize_override(o: PermissionOverride) -> dict:
        return {
            "id": o.pk,
            "user_id": o.user_id,
            "user_name": user_display(o.user),
            "codename": o.codename,
            "effect": o.effect,
            "reason": o.reason,
            "created_by": user_display(o.created_by),
            "created_at": o.created_at,
            "revoked_at": o.revoked_at,
            "revoked_by": user_display(o.revoked_by) if o.revoked_by else "",
            "revoke_reason": o.revoke_reason,
        }

    @staticmethod
    def overrides(acc: NovedadesAccess) -> list[dict]:
        PermissionAdminService._check(acc)
        return [
            PermissionAdminService.serialize_override(o)
            for o in PermissionOverride.objects.select_related("user", "created_by", "revoked_by")
        ]

    @staticmethod
    def create_override(
        acc: NovedadesAccess, *, user_id, codename: str, effect: str, reason: str, context=None
    ):
        PermissionAdminService._check(acc)
        if int(user_id) == acc.user.pk:
            raise _forbidden("No puede otorgarse ni restringirse permisos a sí mismo.")
        target = User.objects.filter(pk=user_id).first()
        if target is None:
            raise _not_found("Usuario no encontrado.")
        role = perms.operational_role_of(target)
        if role is None:
            raise NovedadesError(
                "Las excepciones solo aplican a Supervisores y Asistentes de Operaciones."
            )
        if not perms.is_configurable(role, codename):
            raise NovedadesError(
                "Ese permiso no es configurable para el rol del usuario.", code="not_configurable"
            )
        if effect not in PermissionOverride.Effect.values:
            raise NovedadesError("Efecto inválido.")
        reason = (reason or "").strip()
        if not reason:
            raise NovedadesError(
                "Indique el motivo de la excepción.", details={"reason": ["Obligatorio."]}
            )
        with transaction.atomic():
            PermissionOverride.objects.filter(
                user=target, codename=codename, revoked_at__isnull=True
            ).update(
                revoked_at=timezone.now(),
                revoked_by=acc.user,
                revoke_reason="Reemplazada por una nueva excepción",
            )
            override = PermissionOverride.objects.create(
                user=target, codename=codename, effect=effect, reason=reason, created_by=acc.user
            )
            EventService.log(
                actor=acc.user,
                action="permission.override_created",
                target_type="user",
                target_id=target.pk,
                target_label=user_display(target),
                field=codename,
                new_value="Concede" if effect == "GRANT" else "Restringe",
                reason=reason,
                context=context,
            )
        return override

    @staticmethod
    def revoke_override(acc: NovedadesAccess, override_id, reason: str, *, context=None):
        PermissionAdminService._check(acc)
        override = PermissionOverride.objects.select_related("user").filter(pk=override_id).first()
        if override is None:
            raise _not_found("Excepción no encontrada.")
        if override.user_id == acc.user.pk:
            raise _forbidden("No puede modificar sus propias excepciones.")
        if override.revoked_at is not None:
            return override
        override.revoked_at = timezone.now()
        override.revoked_by = acc.user
        override.revoke_reason = (reason or "").strip()
        override.save(update_fields=["revoked_at", "revoked_by", "revoke_reason"])
        EventService.log(
            actor=acc.user,
            action="permission.override_revoked",
            target_type="user",
            target_id=override.user_id,
            target_label=user_display(override.user),
            field=override.codename,
            old_value="Concede" if override.effect == "GRANT" else "Restringe",
            new_value="Revocada",
            reason=override.revoke_reason,
            context=context,
        )
        return override
