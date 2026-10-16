"""Lógica de negocio del módulo Control Operativo de Novedades.

Toda autorización se recibe ya resuelta en un `NovedadesAccess` (ver
`access.py`) y se vuelve a comprobar aquí contra el registro concreto:
ocultar un botón en el frontend nunca es la barrera de seguridad.
"""

import logging
import threading
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMultiAlternatives
from django.db import IntegrityError, close_old_connections, transaction
from django.db.models import BigIntegerField, Count, F, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.template.loader import render_to_string
from django.utils import timezone

from apps.configuration.models import Holiday, SystemConfigHistory
from apps.configuration.services import (
    get_effective_config_value,
    get_holiday_set,
    is_working_day,
    set_config_value,
)
from apps.core.audit import record_audit_event
from apps.core.models import AuditLog
from apps.notifications.services import notify_many
from apps.permissions.authorization import user_has_permission
from apps.tasks.business_time import BUSINESS_TZ_OFFSET_HOURS, business_calendar_day

from . import access as perms
from .access import SUPERVISOR_ROLE, NovedadesAccess
from .models import (
    ClosedPeriodCorrection,
    Collaborator,
    CollaboratorAssignment,
    CollaboratorEntryNotification,
    CollaboratorExitNotification,
    CollaboratorNotificationRecipient,
    CollaboratorStatusChange,
    DepuratedOvertime,
    DepurationChange,
    ImportBatch,
    NovedadEvent,
    OperationalPeriod,
    OvertimeDepuration,
    OvertimeMonthClose,
    OvertimeRecord,
    PendingNotification,
    PermissionOverride,
    SupervisorPeriod,
    WorkedDay,
)
from .periods import (
    WEEKDAY_NAMES_ES,
    MonthKey,
    PeriodKey,
    is_weekend,
    month_for_date,
    period_for_date,
)

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


def _parse_date_param(value, name: str) -> date:
    """Fecha de un parámetro de consulta (AAAA-MM-DD) o error 400 claro."""
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError as exc:
        raise NovedadesError(
            f"Fecha inválida en «{name}»: use el formato AAAA-MM-DD.", details={name: ["Inválida."]}
        ) from exc


def _parse_id_param(value, name: str) -> int:
    """Identificador numérico de un parámetro de consulta o error 400 claro."""
    try:
        return int(str(value).strip())
    except ValueError as exc:
        raise NovedadesError(
            f"Valor inválido en «{name}».", details={name: ["Debe ser numérico."]}
        ) from exc


def business_range(first: date, last: date) -> tuple[datetime, datetime]:
    """[inicio, fin) en UTC de los días `first`..`last` del calendario del
    negocio (UTC-5)."""
    offset = timedelta(hours=BUSINESS_TZ_OFFSET_HOURS)
    start = datetime.combine(first, time.min, tzinfo=dt_timezone.utc) + offset
    end = datetime.combine(last + timedelta(days=1), time.min, tzinfo=dt_timezone.utc) + offset
    return start, end


def business_stamp(moment: datetime | None = None) -> str:
    """Fecha y hora en la zona del negocio (UTC-5, ver `apps.tasks.business_time`)."""
    moment = moment or timezone.now()
    return (moment - timedelta(hours=BUSINESS_TZ_OFFSET_HOURS)).strftime("%d/%m/%Y %H:%M")


# Categorías de alerta (la campana las pinta con color + icono + texto).
ALERT_DELETION = "deletion"  # rojo
ALERT_NEW_COLLABORATOR = "new_collaborator"  # azul
ALERT_STATUS_CHANGE = "status_change"  # rojo: pasó a Inactivo o Suspendido


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
                    reason=change.get("reason", "")[:500],
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
    def notify_admins(
        message: str, *, exclude_user=None, category: str = "", dedup_key: str | None = None
    ) -> None:
        """`category` da el color de la alerta; `dedup_key` evita repetirla
        (reintentos, doble clic). Se envía solo si la transacción se confirma:
        una operación fallida o revertida nunca genera alerta."""

        def _send():
            # Corre DESPUÉS de confirmar la operación: cualquier fallo aquí
            # (destinatarios, envío o el respaldo pendiente) se registra y se
            # absorbe; nunca convierte en error una operación ya guardada.
            recipients = []
            try:
                recipients = list(NotificationService.admin_recipients())
                if exclude_user is not None:
                    recipients = [u for u in recipients if u.pk != exclude_user.pk]
                if not recipients:
                    return
                notify_many(
                    users=recipients, message=message, category=category, dedup_key=dedup_key
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "No se pudo notificar al Administrador; queda pendiente de reintento"
                )
                try:
                    PendingNotification.objects.create(
                        message=message,
                        category=category,
                        dedup_key=dedup_key or "",
                        recipient_ids=[u.pk for u in recipients],
                        attempts=1,
                        last_error=str(exc)[:500],
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("Tampoco se pudo guardar la notificación pendiente")

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
                    users=User.objects.filter(pk__in=item.recipient_ids),
                    message=item.message,
                    category=item.category,
                    dedup_key=item.dedup_key or None,
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
        # Pendientes: solo miembros ACTUALES del equipo y días hábiles sin
        # ninguna celda (un día cargado por el equipo anterior no está pendiente).
        member_ids = set(
            collaborators.filter(
                status=Collaborator.Status.ACTIVE, current_supervisor=supervisor
            ).values_list("pk", flat=True)
        )
        workdays = [d for d in key.dates() if not is_weekend(d)]
        days = WorkedDay.objects.filter(period=period, supervisor=supervisor)
        filled = days.filter(hours__isnull=False)
        any_filled = set(
            WorkedDay.objects.filter(
                period=period, collaborator_id__in=member_ids, hours__isnull=False
            ).values_list("collaborator_id", "date")
        )
        pending = sum(1 for cid in member_ids for d in workdays if (cid, d) not in any_filled)
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
        with transaction.atomic():
            sp = SupervisorPeriod.objects.select_for_update().get(pk=sp.pk)
            if sp.status == SupervisorPeriod.Status.CLOSED:
                return {"already_closed": True, "period": key.code, "summary": sp.summary}
            # Con el período bloqueado: ningún guardado concurrente puede
            # colarse entre el resumen y el cierre (ver `save_cells`).
            summary = PeriodService.close_summary(acc, key, supervisor)
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
    # Marca de nuevo ingreso (casilla del formulario de alta; en la importación,
    # columna NUEVO INGRESO con X): dispara el correo al segundo día válido.
    is_new_hire: bool = False


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

        try:
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
        except IntegrityError as exc:
            # Otra solicitud registró la misma cédula entre la validación y el alta.
            raise NovedadesError(
                f"La cédula {cedula} acaba de registrarse en la base; recargue la lista.",
                code="duplicate",
                status=409,
            ) from exc
        with transaction.atomic():
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
            NotificationService.notify_admins(
                f"Nuevo colaborador registrado en la base: {full_name} — cédula {cedula} — cargo "
                f"{collaborator.cargo or 's/d'} — área {collaborator.area or 's/d'} — regional "
                f"{collaborator.regional or 's/d'}. Supervisor: {user_display(supervisor)}. "
                f"Registrado por {user_display(acc.user)} el {business_stamp()} "
                f"(origen: formulario; período {current.period.key.label}).",
                exclude_user=acc.user,
                category=ALERT_NEW_COLLABORATOR,
                dedup_key=f"novedades:collaborator-new:{collaborator.pk}",
            )
            if data.is_new_hire:
                EntryNotificationService.register(collaborator, acc.user)
        return collaborator

    @staticmethod
    def update(
        acc: NovedadesAccess, collaborator_id, changes: dict, *, context=None
    ) -> Collaborator:
        collaborator = CollaboratorService._get_for_write(acc, collaborator_id)
        editable = ("full_name", "regional", "area", "cargo")
        updated_fields: list[str] = []
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
                    period=CollaboratorService._event_period(collaborator.current_supervisor),
                    target_type="collaborator",
                    target_id=collaborator.pk,
                    target_label=f"{collaborator.full_name} ({collaborator.cedula})",
                    field=field,
                    old_value=old,
                    new_value=new,
                    context=context,
                )
                updated_fields.append(field)
            if updated_fields:
                # Solo los campos editados: un `save()` completo reescribiría el
                # estado o el supervisor con valores viejos y desharía un
                # cambio de estado o una reasignación concurrentes.
                collaborator.save(update_fields=[*updated_fields, "updated_at"])
        return collaborator

    @staticmethod
    def _event_period(supervisor):
        """Período al que se asocia un evento de la base de colaboradores: el
        período abierto vigente del supervisor (mismo criterio que el alta).
        Sin esto el evento quedaba con período vacío y el Historial de
        registros, que por defecto filtra por período, no lo mostraba."""
        if supervisor is None:
            return None
        return PeriodService.ensure_current(supervisor).period

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
            return collaborator  # mismo estado: no hay cambio ni evento
        labels = dict(Collaborator.Status.choices)
        collaborator.exit_notification_event = None
        with transaction.atomic():
            # Actualización condicional: si dos envíos llegan a la vez (doble
            # clic, reintento), solo el primero cambia el estado; el segundo
            # ve que ya no está en el estado anterior y no registra nada.
            changed = Collaborator.objects.filter(pk=collaborator.pk, status=previous).update(
                status=new_status, updated_at=timezone.now()
            )
            if not changed:
                collaborator.refresh_from_db()
                return collaborator
            collaborator.status = new_status
            status_change = CollaboratorStatusChange.objects.create(
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
                period=CollaboratorService._event_period(collaborator.current_supervisor),
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
                NotificationService.notify_admins(
                    f"Cambio de estado: {collaborator.full_name} (cédula {collaborator.cedula}) pasó de "
                    f"{labels[previous]} a {labels[new_status]}. Supervisor: "
                    f"{user_display(collaborator.current_supervisor)}. Cambiado por "
                    f"{user_display(acc.user)} el {business_stamp()}. Motivo: {reason}.",
                    exclude_user=acc.user,
                    category=ALERT_STATUS_CHANGE,
                    dedup_key=f"novedades:status-change:{status_change.pk}",
                )
            if previous == Collaborator.Status.ACTIVE and new_status in (
                Collaborator.Status.INACTIVE,
                Collaborator.Status.SUSPENDED,
            ):
                # Correo de cambio de estado (Activo → Inactivo o Suspendido;
                # ninguna otra transición): el evento se registra en la MISMA
                # transacción que el cambio (si el cambio falla, no hay
                # evento) y el envío corre después de confirmarla.
                collaborator.exit_notification_event = ExitNotificationService.register(
                    status_change
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
            EventService.log(
                actor=acc.user,
                action="collaborator.reassigned",
                supervisor=new_supervisor,
                period=CollaboratorService._event_period(new_supervisor),
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
    def delete(acc: NovedadesAccess, collaborator_id, reason: str, *, context=None) -> None:
        """Elimina a un colaborador de la base oficial. Solo el Administrador del
        módulo, con motivo, y SOLO si nunca tuvo novedades: si tiene días
        laborados u horas extras (aunque estén eliminadas), su historia se
        conserva y lo que corresponde es pasarlo a Inactivo. Queda la evidencia
        en el historial del módulo y en la auditoría general."""
        if not acc.national_write or not acc.can(perms.COLABORADORES):
            raise _forbidden("Solo el Administrador puede eliminar colaboradores de la base.")
        reason = (reason or "").strip()
        if not reason:
            raise NovedadesError(
                "Indique el motivo de la eliminación.", details={"reason": ["Obligatorio."]}
            )
        collaborator = (
            Collaborator.objects.select_related("current_supervisor")
            .filter(pk=collaborator_id)
            .first()
        )
        if collaborator is None:
            raise _not_found("Colaborador no encontrado (puede que ya se haya eliminado).")
        if collaborator.worked_days.exists() or collaborator.overtime_records.exists():
            raise NovedadesError(
                f"{collaborator.full_name} tiene días laborados u horas extras registrados: no se elimina "
                "para conservar la historia. Cambie su estado a Inactivo.",
                code="has_history",
                status=409,
            )
        snapshot = {
            "cedula": collaborator.cedula,
            "full_name": collaborator.full_name,
            "regional": collaborator.regional,
            "area": collaborator.area,
            "cargo": collaborator.cargo,
            "status": collaborator.status,
            "supervisor": user_display(collaborator.current_supervisor),
        }
        label = f"{collaborator.full_name} ({collaborator.cedula})"
        with transaction.atomic():
            collaborator = Collaborator.objects.select_for_update().get(pk=collaborator.pk)
            if collaborator.worked_days.exists() or collaborator.overtime_records.exists():
                raise NovedadesError(
                    f"{collaborator.full_name} acaba de recibir novedades: no se elimina.",
                    code="has_history",
                    status=409,
                )
            supervisor = collaborator.current_supervisor
            pk = collaborator.pk
            collaborator.assignments.all().delete()
            collaborator.status_changes.all().delete()
            collaborator.delete()
            EventService.log(
                actor=acc.user,
                action="collaborator.deleted",
                supervisor=supervisor,
                period=CollaboratorService._event_period(supervisor),
                target_type="collaborator",
                target_id=pk,
                target_label=label,
                old_value=", ".join(f"{k}={v}" for k, v in snapshot.items()),
                new_value="ELIMINADO",
                reason=reason,
                context=context,
            )
            NotificationService.notify_admins(
                f"Colaborador eliminado de la base oficial: {snapshot['full_name']} (cédula "
                f"{snapshot['cedula']}) — base de {snapshot['supervisor']}. Eliminado por "
                f"{user_display(acc.user)} el {business_stamp()}. Motivo: {reason}.",
                exclude_user=acc.user,
                category=ALERT_DELETION,
                dedup_key=f"novedades:collaborator-deleted:{pk}",
            )

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
    def cells(period, collaborators, supervisor) -> dict[int, dict[str, dict]]:
        """Celdas persistidas por colaborador y fecha ISO. `hours=None` es una
        celda vacía (no reportada) y `"0"` un cero reportado: se conservan
        distintos. La usan la matriz y el correo de salida, para que ambos
        muestren exactamente lo mismo."""
        cells: dict[int, dict[str, dict]] = {}
        for wd in WorkedDay.objects.filter(
            period=period, collaborator__in=collaborators
        ).select_related("supervisor"):
            cell = {
                "hours": _fmt(wd.hours) if wd.hours is not None else None,
                "version": wd.version,
            }
            if wd.supervisor_id != supervisor.pk:
                # Celda del equipo anterior (colaborador reasignado): se ve,
                # pero no se edita desde este equipo ni suma en su total.
                cell["other_team"] = user_display(wd.supervisor)
            cells.setdefault(wd.collaborator_id, {})[wd.date.isoformat()] = cell
        return cells

    @staticmethod
    def row_total(row_cells: dict[str, dict]) -> Decimal:
        """Total de una fila: suma las horas reportadas por el equipo actual
        (las celdas vacías no cuentan y las del equipo anterior tampoco)."""
        return sum(
            (
                Decimal(v["hours"])
                for v in row_cells.values()
                if v["hours"] is not None and "other_team" not in v
            ),
            Decimal("0"),
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
        cells = WorkedDayService.cells(period, collaborators, supervisor)
        holidays = WorkedDayService._holidays(key)
        # Plazo por fecha de trabajo, ya resuelto para este usuario: la
        # pantalla bloquea la columna con el mismo criterio que el servidor.
        holiday_set = get_holiday_set()
        now = timezone.now()
        current_day = today()

        def lock_of(d: date) -> tuple[str, str]:
            if d > current_day:
                return "future", ""
            deadline = RecordDeadlineService.deadline(
                RecordDeadlineService.WORKED_DAYS, d, holiday_set
            )
            label = deadline_label(deadline)
            if now >= deadline:
                late_ok = acc.can_bypass_deadline_for(RecordDeadlineService.WORKED_DAYS)
                return ("late" if late_ok else "expired"), label
            return "", label

        columns = []
        for d in key.dates():
            lock, until = lock_of(d)
            columns.append(
                {
                    "date": d.isoformat(),
                    "day": d.day,
                    "weekday": WEEKDAY_NAMES_ES[d.weekday()],
                    "is_weekend": is_weekend(d),
                    "holiday": holidays.get(d, ""),
                    # "" = editable en plazo · "future" · "expired" (bloqueada
                    # para el Supervisor) · "late" (vencida, editable por excepción)
                    "deadline_state": lock,
                    "deadline_label": until,
                }
            )
        rows = []
        for c in collaborators:
            row_cells = cells.get(c.pk, {})
            total = WorkedDayService.row_total(row_cells)
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
            "closable": bool(
                is_open and acc.can(perms.CERRAR) and acc.can_write_for_supervisor(supervisor.pk)
            ),
            "columns": columns,
            "rows": rows,
        }

    @staticmethod
    def consolidated_matrix(acc: NovedadesAccess, key: PeriodKey) -> dict:
        """Vista "Todos los supervisores" (alcance nacional: Asistente y
        Administrador): une las matrices de cada supervisor AUTORIZADO,
        reutilizando `matrix` tal cual (mismas reglas de plazo, cierre y
        edición por equipo). Cada fila lleva su supervisor, si es editable y
        el estado del período de ese equipo; el cierre sigue siendo por equipo."""
        if not acc.can(perms.ACCEDER):
            raise _forbidden()
        supervisors = list(PeriodService.supervisors())
        readable = acc.readable_supervisor_ids()
        if readable is not None:
            supervisors = [s for s in supervisors if s.pk in readable]
        parts = [(s, WorkedDayService.matrix(acc, key, s)) for s in supervisors]
        rows = []
        for supervisor, part in parts:
            for row in part["rows"]:
                rows.append(
                    {
                        **row,
                        "supervisor_id": supervisor.pk,
                        "supervisor_name": part["supervisor"]["name"],
                        "editable": part["editable"],
                        "period_status": part["period"]["status"],
                    }
                )
        statuses = [part["period"]["status"] for _, part in parts]
        closed = sum(1 for s in statuses if s == SupervisorPeriod.Status.CLOSED)
        if any(s == SupervisorPeriod.Status.OPEN for s in statuses):
            overall = SupervisorPeriod.Status.OPEN
        elif statuses and closed == len(statuses):
            overall = SupervisorPeriod.Status.CLOSED
        else:
            overall = "NOT_STARTED"
        return {
            "period": {
                "code": key.code,
                "label": key.label,
                "start_date": key.start_date,
                "end_date": key.end_date,
                "status": overall,
                "closed_at": None,
                "closed_by": "",
            },
            "supervisor": None,
            "editable": any(part["editable"] for _, part in parts),
            # Cerrar, importar y exportar siguen siendo por equipo.
            "closable": False,
            "columns": parts[0][1]["columns"] if parts else [],
            "rows": rows,
            "supervisors_total": len(parts),
            "supervisors_closed": closed,
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
        seen_cells: set[tuple] = set()
        holidays_set = get_holiday_set()
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
            if current is not None and current.supervisor_id != supervisor.pk:
                # Colaborador reasignado: el día lo registró el equipo anterior
                # (su período puede estar cerrado). Solo se corrige por la vía
                # autorizada, nunca desde el equipo nuevo.
                errors.append(
                    {
                        "collaborator_id": cid,
                        "date": day,
                        "message": f"{collaborator.full_name} {day:%d/%m}: lo registró otro equipo; no se modifica desde aquí.",
                        "code": "other_team",
                    }
                )
                continue
            try:
                late = RecordDeadlineService.check(
                    acc, RecordDeadlineService.WORKED_DAYS, day, holidays=holidays_set
                )
            except NovedadesError as exc:
                errors.append(
                    {
                        "collaborator_id": cid,
                        "date": day,
                        "message": exc.message,
                        "code": exc.code,
                    }
                )
                continue
            if (cid, day) in seen_cells:
                errors.append(
                    {
                        "collaborator_id": cid,
                        "date": day,
                        "message": f"{collaborator.full_name} {day:%d/%m}: la celda viene repetida.",
                    }
                )
                continue
            seen_cells.add((cid, day))
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
            stale_empty = "version" in cell and expected_version is None and current is not None
            if current is not None and (
                stale_empty
                or (expected_version is not None and int(expected_version) != current.version)
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
            plan.append((collaborator, day, current, old, value, late))

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
            locked = SupervisorPeriod.objects.select_for_update().get(pk=sp.pk)
            if locked.status == SupervisorPeriod.Status.CLOSED:
                raise NovedadesError(
                    f"El período {key.label} se cerró mientras guardaba: no admite edición ordinaria.",
                    code="period_closed",
                    status=409,
                )
            for collaborator, day, current, old, value, late in plan:
                if current is None:
                    try:
                        with transaction.atomic():
                            current = WorkedDay.objects.create(
                                collaborator=collaborator,
                                period=period,
                                supervisor=supervisor,
                                date=day,
                                hours=value,
                                updated_by=acc.user,
                            )
                    except IntegrityError as exc:
                        raise NovedadesError(
                            f"Otro usuario registró {collaborator.full_name} {day:%d/%m} mientras guardaba; recargue.",
                            code="conflict",
                            status=409,
                        ) from exc
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
                        "reason": RecordDeadlineService.late_reason(acc) if late else "",
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
        if changes:
            # Correo de ingreso: solo DESPUÉS de confirmar lo guardado (también
            # dentro de una importación, que confirma al final).
            touched = {collaborator.pk for collaborator, *_ in plan}
            transaction.on_commit(lambda: EntryNotificationService.check(touched))
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


# ── Plazo de registro por fecha de trabajo (Días laborados y Horas extras) ────


BUSINESS_TZ = dt_timezone(-timedelta(hours=BUSINESS_TZ_OFFSET_HOURS))


def business_deadline(first_day: date, hours: int, holidays) -> datetime:
    """Fin EXCLUSIVO de un plazo de `hours` horas laborables que empieza a las
    00:00 (hora de Ecuador) de `first_day`. Cuenta solo días hábiles (lunes a
    viernes que no son feriados de Ajustes), 24 horas cada uno; si
    `first_day` no es hábil, el cómputo arranca en el siguiente día hábil.
    Única implementación de la regla: la usan el plazo por fecha de trabajo y
    el plazo de cierre mensual de Horas extras."""
    day = first_day
    remaining = hours
    # Tope de seguridad: ningún calendario real tiene 60 días seguidos no hábiles.
    for _ in range(60):
        if is_working_day(day, holidays):
            if remaining <= 24:
                start = datetime.combine(day, time.min, tzinfo=BUSINESS_TZ)
                return start + timedelta(hours=remaining)
            remaining -= 24
        day += timedelta(days=1)
    raise NovedadesError("No se pudo calcular el plazo: revise el calendario de feriados.")


def deadline_label(deadline: datetime) -> str:
    """Último minuto incluido, en hora de Ecuador: un plazo que termina a las
    00:00 se muestra como las 23:59 del día anterior."""
    local = deadline.astimezone(BUSINESS_TZ) - timedelta(minutes=1)
    return f"{WEEKDAY_NAMES_ES[local.weekday()].lower()} {local:%d/%m/%Y %H:%M}"


class RecordDeadlineService:
    """Plazo para registrar o corregir UNA fecha de trabajo (pedido explícito,
    2026-10-13, decisiones del usuario):

    - Se cuenta desde el FIN del día de trabajo (00:00 del día siguiente, hora
      de Ecuador) en horas laborables: 24 h por día hábil, lunes a viernes sin
      feriados (misma regla que el plazo de cierre mensual). Valor inicial
      48 h: el martes 13 se puede registrar hasta el jueves 15 23:59; el
      viernes 16, hasta el martes 20 23:59.
    - Se configura por separado para Días laborados y Horas extras, solo el
      Administrador, en Ajustes. Cada fecha usa el valor vigente al empezar
      su plazo (no retroactivo).
    - Ninguna fecha futura se registra (nadie: tampoco Asistente ni
      Administrador).
    - Vencido el plazo, el Supervisor ya no crea, edita ni elimina esa fecha;
      el Asistente de Operaciones y el Administrador sí (queda auditado como
      "fuera de plazo"), sin saltarse cierres, equipos ni fechas futuras.
    - Es independiente del período 23 → 22 y del cierre mensual de Horas
      extras: vencer una fecha no cierra nada."""

    WORKED_DAYS = "worked_days"
    OVERTIME = "overtime"
    CONFIG_KEYS = {
        WORKED_DAYS: "novedades_worked_days_deadline_hours",
        OVERTIME: "novedades_overtime_deadline_hours",
    }
    LABELS = {WORKED_DAYS: "Días laborados", OVERTIME: "Horas extras"}
    DEFAULT_HOURS = 48
    MIN_HOURS = 24
    MAX_HOURS = 240
    MODE = (
        "Horas laborables desde el fin del día de trabajo: 24 h por día hábil "
        "(lunes a viernes sin feriados), hora de Ecuador (UTC-5)."
    )
    LATE_REASON = "Registro fuera de plazo (excepción de Asistente/Administrador)"
    LATE_REASON_PERMISSION = "Corrección fuera de plazo (permiso «Editar celdas de Días laborados»)"

    @staticmethod
    def late_reason(acc: NovedadesAccess) -> str:
        """Motivo que queda en el historial de una escritura fuera de plazo."""
        if acc.can_bypass_deadline:
            return RecordDeadlineService.LATE_REASON
        return RecordDeadlineService.LATE_REASON_PERMISSION

    @staticmethod
    def window_start(day: date) -> datetime:
        return datetime.combine(day + timedelta(days=1), time.min, tzinfo=BUSINESS_TZ)

    @staticmethod
    def hours_for(kind: str, day: date) -> int:
        value = get_effective_config_value(
            RecordDeadlineService.CONFIG_KEYS[kind],
            RecordDeadlineService.window_start(day),
            RecordDeadlineService.DEFAULT_HOURS,
        )
        return min(
            max(int(value), RecordDeadlineService.MIN_HOURS), RecordDeadlineService.MAX_HOURS
        )

    @staticmethod
    def deadline(kind: str, day: date, holidays=None) -> datetime:
        if holidays is None:
            holidays = get_holiday_set()
        return business_deadline(
            day + timedelta(days=1), RecordDeadlineService.hours_for(kind, day), holidays
        )

    @staticmethod
    def check(acc: NovedadesAccess, kind: str, day: date, *, holidays=None, now=None) -> bool:
        """Valida la fecha de trabajo para una escritura ordinaria. Devuelve
        True si es una escritura FUERA de plazo permitida por excepción (para
        dejarla marcada en el historial). Lanza NovedadesError si no procede.
        Se evalúa siempre en el servidor, con su reloj y el día de Ecuador."""
        current = today()
        if day > current:
            raise NovedadesError(
                f"{day:%d/%m/%Y} es una fecha futura: no se registran novedades por adelantado.",
                code="future_date",
            )
        deadline = RecordDeadlineService.deadline(kind, day, holidays)
        expired = (now or timezone.now()) >= deadline
        if not expired:
            return False
        if acc.can_bypass_deadline_for(kind):
            return True
        raise NovedadesError(
            f"El plazo para registrar {day:%d/%m/%Y} venció el {deadline_label(deadline)}. "
            "Solicite la corrección al Asistente de Operaciones o al Administrador.",
            code="deadline_passed",
            status=409,
        )

    @staticmethod
    def earliest_open_date(kind: str, *, holidays=None, now=None) -> date:
        """Primera fecha cuyo plazo sigue vigente (para la pantalla)."""
        if holidays is None:
            holidays = get_holiday_set()
        now = now or timezone.now()
        day = today()
        for _ in range(60):
            previous = day - timedelta(days=1)
            if RecordDeadlineService.deadline(kind, previous, holidays) <= now:
                return day
            day = previous
        return day

    @staticmethod
    def rules(acc: NovedadesAccess) -> dict:
        holidays = get_holiday_set()
        return {
            "today": today(),
            "can_bypass_deadline": acc.can_bypass_deadline,
            "mode": RecordDeadlineService.MODE,
            **{
                kind: {
                    "can_bypass": acc.can_bypass_deadline_for(kind),
                    "hours": RecordDeadlineService.hours_for(kind, today()),
                    "earliest_open_date": RecordDeadlineService.earliest_open_date(
                        kind, holidays=holidays
                    ),
                }
                for kind in (RecordDeadlineService.WORKED_DAYS, RecordDeadlineService.OVERTIME)
            },
        }

    @staticmethod
    def settings(acc: NovedadesAccess) -> dict:
        if not acc.can(perms.ACCEDER):
            raise _forbidden()
        items = []
        for kind, key in RecordDeadlineService.CONFIG_KEYS.items():
            record = (
                SystemConfigHistory.objects.filter(key=key, valid_until__isnull=True)
                .select_related("updated_by")
                .order_by("-valid_from")
                .first()
            )
            items.append(
                {
                    "kind": kind,
                    "label": RecordDeadlineService.LABELS[kind],
                    "hours": RecordDeadlineService.hours_for(kind, today()),
                    "configured": record is not None,
                    "updated_at": record.valid_from if record else None,
                    "updated_by": (
                        user_display(record.updated_by) if record and record.updated_by else ""
                    ),
                }
            )
        return {
            "items": items,
            "mode": RecordDeadlineService.MODE,
            "min_hours": RecordDeadlineService.MIN_HOURS,
            "max_hours": RecordDeadlineService.MAX_HOURS,
            "can_edit": acc.national_write,
            "policy": "Un cambio aplica a las fechas cuyo plazo todavía no empezó; "
            "no altera vencimientos en curso ni registros guardados.",
        }

    @staticmethod
    def set_hours(acc: NovedadesAccess, changes: dict, *, context=None) -> dict:
        if not acc.national_write:
            raise _forbidden("Solo el Administrador configura los plazos de registro.")
        for kind, hours in changes.items():
            if kind not in RecordDeadlineService.CONFIG_KEYS:
                raise NovedadesError("Plazo desconocido.")
            if not isinstance(hours, int) or not (
                RecordDeadlineService.MIN_HOURS <= hours <= RecordDeadlineService.MAX_HOURS
            ):
                raise NovedadesError(
                    f"El plazo debe ser un número entero de horas entre "
                    f"{RecordDeadlineService.MIN_HOURS} y {RecordDeadlineService.MAX_HOURS}.",
                    details={kind: ["Fuera de rango."]},
                )
        with transaction.atomic():
            for kind, hours in changes.items():
                key = RecordDeadlineService.CONFIG_KEYS[kind]
                previous = int(
                    get_effective_config_value(
                        key, timezone.now(), RecordDeadlineService.DEFAULT_HOURS
                    )
                )
                if previous == hours:
                    continue
                set_config_value(key, str(hours), acc.user)
                EventService.log(
                    actor=acc.user,
                    action="deadline.changed",
                    target_type="config",
                    target_id=key,
                    target_label=f"Plazo de registro de {RecordDeadlineService.LABELS[kind]}",
                    field=key,
                    old_value=str(previous),
                    new_value=str(hours),
                    context=context,
                )
        return RecordDeadlineService.settings(acc)


# ── Horas extras: mes calendario, plazo de cierre y cierre manual ─────────────


class OvertimeMonthService:
    """Ciclo mensual de Horas extras (pedido explícito, 2026-10-12):

    - Cada registro pertenece al MES CALENDARIO de su fecha de trabajo
      (`periods.MonthKey`), independiente del corte 23 → 22 de Días laborados.
    - Al empezar un mes, el anterior sigue editable durante un plazo de
      48 a 72 horas laborables (configurable en Ajustes). Se cuentan solo
      los días hábiles —lunes a viernes que no son feriados de
      `configuration.Holiday`—, cada uno con sus 24 horas, en hora de
      Ecuador (UTC-5, sin horario de verano). Si el mes nuevo empieza un
      día no hábil, el cómputo arranca a las 00:00 del siguiente día hábil.
    - NO hay cierre automático: vencido el plazo, el mes sigue editable,
      la pantalla lo marca "vencido" y se avisa al Administrador. El mes se
      cierra solo cuando el Supervisor (su equipo) o el Administrador pulsa
      "Cerrar mes"; desde ahí se bloquea toda escritura ordinaria —
      formulario, captura masiva, importación y API directa— y solo cabe la
      corrección autorizada del Administrador (`CorrectionService`)."""

    CONFIG_KEY = "novedades_overtime_grace_hours"
    DEFAULT_HOURS = 48
    MIN_HOURS = 48
    MAX_HOURS = 72
    BUSINESS_TZ = dt_timezone(-timedelta(hours=BUSINESS_TZ_OFFSET_HOURS))

    # Estados que ve la pantalla. Solo CLOSED bloquea.
    OPEN = "OPEN"  # mes en curso
    GRACE = "GRACE"  # mes terminado, dentro del plazo
    OVERDUE = "OVERDUE"  # plazo vencido, sin cerrar: solo aviso
    CLOSED = "CLOSED"
    FUTURE = "FUTURE"

    @staticmethod
    def current_month() -> MonthKey:
        return month_for_date(today())

    @staticmethod
    def window_start(month: MonthKey) -> datetime:
        """Primer instante (00:00 hora de Ecuador) del mes siguiente, en UTC."""
        first = month.next().start_date
        return datetime.combine(first, time.min, tzinfo=OvertimeMonthService.BUSINESS_TZ)

    @staticmethod
    def grace_hours(month: MonthKey) -> int:
        """Horas configuradas VIGENTES al empezar el plazo de ese mes: cambiar
        el ajuste no altera los plazos que ya empezaron (mismo criterio no
        retroactivo de `get_effective_config_value`)."""
        value = get_effective_config_value(
            OvertimeMonthService.CONFIG_KEY,
            OvertimeMonthService.window_start(month),
            OvertimeMonthService.DEFAULT_HOURS,
        )
        hours = int(value)
        return min(max(hours, OvertimeMonthService.MIN_HOURS), OvertimeMonthService.MAX_HOURS)

    @staticmethod
    def current_grace_hours() -> int:
        value = get_effective_config_value(
            OvertimeMonthService.CONFIG_KEY, timezone.now(), OvertimeMonthService.DEFAULT_HOURS
        )
        return min(max(int(value), OvertimeMonthService.MIN_HOURS), OvertimeMonthService.MAX_HOURS)

    @staticmethod
    def set_grace_hours(acc: NovedadesAccess, hours: int, *, context=None) -> int:
        if not acc.national_write:
            raise _forbidden("Solo el Administrador configura el plazo de Horas extras.")
        if not isinstance(hours, int) or not (
            OvertimeMonthService.MIN_HOURS <= hours <= OvertimeMonthService.MAX_HOURS
        ):
            raise NovedadesError(
                f"El plazo debe ser un número entero de horas entre {OvertimeMonthService.MIN_HOURS} "
                f"y {OvertimeMonthService.MAX_HOURS}.",
                details={"grace_hours": ["Fuera de rango."]},
            )
        previous = OvertimeMonthService.current_grace_hours()
        if previous == hours:
            return hours
        with transaction.atomic():
            set_config_value(OvertimeMonthService.CONFIG_KEY, str(hours), acc.user)
            EventService.log(
                actor=acc.user,
                action="overtime_month.grace_changed",
                target_type="config",
                target_id=OvertimeMonthService.CONFIG_KEY,
                target_label="Plazo de cierre de Horas extras (horas laborables)",
                field="grace_hours",
                old_value=str(previous),
                new_value=str(hours),
                context=context,
            )
        return hours

    @staticmethod
    def deadline(month: MonthKey, *, hours: int | None = None, holidays=None) -> datetime:
        """Fin EXCLUSIVO del plazo del mes `month`: hasta este instante (sin
        incluirlo) el plazo está vigente. Determinista: mismo resultado en
        servidor y pantalla, que lo recibe ya calculado."""
        if hours is None:
            hours = OvertimeMonthService.grace_hours(month)
        if holidays is None:
            holidays = get_holiday_set()
        return business_deadline(month.next().start_date, hours, holidays)

    @staticmethod
    def business_seconds_between(start: datetime, end: datetime, holidays) -> int:
        """Segundos de días hábiles (24 h cada uno, hora de Ecuador) entre dos
        instantes: la misma unidad con que se mide el plazo."""
        if end <= start:
            return 0
        tz = OvertimeMonthService.BUSINESS_TZ
        cursor = start.astimezone(tz)
        end_local = end.astimezone(tz)
        total = 0
        while cursor < end_local:
            next_midnight = datetime.combine(cursor.date() + timedelta(days=1), time.min, tzinfo=tz)
            chunk_end = min(next_midnight, end_local)
            if is_working_day(cursor.date(), holidays):
                total += int((chunk_end - cursor).total_seconds())
            cursor = chunk_end
        return total

    @staticmethod
    def deadline_label(deadline: datetime) -> str:
        """Último instante incluido, en hora de Ecuador: un plazo que termina a
        las 00:00 se muestra como las 23:59 del día anterior."""
        return deadline_label(deadline)

    @staticmethod
    def closes_for(month: MonthKey, supervisor_ids=None):
        qs = OvertimeMonthClose.objects.filter(year=month.year, month=month.month).select_related(
            "closed_by"
        )
        if supervisor_ids is not None:
            qs = qs.filter(supervisor_id__in=supervisor_ids)
        return {c.supervisor_id: c for c in qs}

    @staticmethod
    def closed_supervisor_ids(month: MonthKey, supervisor_ids) -> set[int]:
        return set(OvertimeMonthService.closes_for(month, supervisor_ids))

    @staticmethod
    def lock_and_check(supervisor_id, month: MonthKey) -> None:
        """Dentro de una transacción: bloquea la fila del supervisor (mismo
        candado que toma `close`) y revalida que el mes siga abierto. Así un
        guardado y un cierre del mismo equipo no se cruzan: o el registro
        entra antes del cierre (y cuenta en su resumen) o se rechaza."""
        list(User.objects.select_for_update().filter(pk=supervisor_id).values_list("pk"))
        if OvertimeMonthClose.objects.filter(
            supervisor_id=supervisor_id, year=month.year, month=month.month
        ).exists():
            raise NovedadesError(
                f"{month.label} de Horas extras se cerró mientras guardaba: "
                "los cambios requieren una corrección autorizada.",
                code="period_closed",
                status=409,
            )

    @staticmethod
    def assert_writable(supervisor, day: date) -> MonthKey:
        """Única comprobación de escritura ordinaria de Horas extras (formulario,
        captura masiva, importación, eliminación). Se valida en el servidor en
        cada solicitud: la pantalla solo refleja el mismo resultado."""
        month = month_for_date(day)
        if OvertimeMonthService.current_month() < month:
            raise NovedadesError(
                f"{month.label} todavía no empieza: no se registran horas extras de meses futuros.",
                code="period_not_open",
            )
        if OvertimeMonthClose.objects.filter(
            supervisor=supervisor, year=month.year, month=month.month
        ).exists():
            raise NovedadesError(
                f"{month.label} de Horas extras ya fue cerrado para {user_display(supervisor)}: "
                "los cambios requieren una corrección autorizada.",
                code="period_closed",
                status=409,
            )
        return month

    @staticmethod
    def status(month: MonthKey, close=None, *, now=None, holidays=None) -> dict:
        now = now or timezone.now()
        hours = OvertimeMonthService.grace_hours(month)
        deadline = OvertimeMonthService.deadline(month, hours=hours, holidays=holidays)
        current = OvertimeMonthService.current_month()
        if close is not None:
            state = OvertimeMonthService.CLOSED
        elif current < month:
            state = OvertimeMonthService.FUTURE
        elif month == current:
            state = OvertimeMonthService.OPEN
        elif now < deadline:
            state = OvertimeMonthService.GRACE
        else:
            state = OvertimeMonthService.OVERDUE
        remaining = max(int((deadline - now).total_seconds()), 0)
        business_remaining = OvertimeMonthService.business_seconds_between(
            now, deadline, holidays if holidays is not None else get_holiday_set()
        )
        if state == OvertimeMonthService.OPEN:
            refresh_in = max(
                int((OvertimeMonthService.window_start(month) - now).total_seconds()), 0
            )
        elif state == OvertimeMonthService.GRACE:
            refresh_in = remaining
        else:
            refresh_in = 0
        return {
            "code": month.code,
            "label": month.label,
            "start_date": month.start_date,
            "end_date": month.end_date,
            "status": state,
            "grace_hours": hours,
            "deadline": deadline,
            "deadline_label": OvertimeMonthService.deadline_label(deadline),
            "remaining_seconds": remaining if state in ("OPEN", "GRACE") else 0,
            # Aviso de "próximo a cerrarse": últimas 24 horas LABORABLES del plazo.
            "closing_soon": state == "GRACE" and business_remaining <= 24 * 3600,
            # Segundos hasta el próximo cambio de estado (fin de mes o fin de
            # plazo): la pantalla vuelve a pedir el estado en ese momento.
            "refresh_in_seconds": refresh_in,
            "closed_at": close.closed_at if close else None,
            "closed_by": user_display(close.closed_by) if close else "",
        }

    @staticmethod
    def months(acc: NovedadesAccess, supervisor=None) -> list[dict]:
        """Meses para el selector: el actual, el anterior y los anteriores que
        tengan registros o cierres (máximo 24). Con `supervisor`, el estado es
        el de ese equipo; sin él (vista nacional), se informa cuántos
        supervisores cerraron."""
        if not acc.can(perms.ACCEDER):
            raise _forbidden()
        if supervisor is not None and not acc.can_read_supervisor(supervisor.pk):
            raise _forbidden("No puede consultar el equipo de otro supervisor.")
        current = OvertimeMonthService.current_month()
        records = OvertimeRecord.objects.filter(deleted_at__isnull=True)
        closes = OvertimeMonthClose.objects.all()
        if supervisor is not None:
            records = records.filter(supervisor=supervisor)
            closes = closes.filter(supervisor=supervisor)
        else:
            ids = acc.readable_supervisor_ids()
            if ids is not None:
                records = records.filter(supervisor_id__in=ids)
                closes = closes.filter(supervisor_id__in=ids)
        keys = {current, current.previous()}
        keys |= {MonthKey(d.year, d.month) for d in records.dates("date", "month")}
        keys |= {MonthKey(y, m) for y, m in closes.values_list("year", "month")}
        keys = sorted((k for k in keys if not current < k), reverse=True)[:24]
        holidays = get_holiday_set()
        if supervisor is None:
            active = list(PeriodService.supervisors())
            readable = acc.readable_supervisor_ids()
            if readable is not None:
                active = [s for s in active if s.pk in readable]
            scope_ids = [s.pk for s in active]
        else:
            active, scope_ids = [supervisor], [supervisor.pk]
        total = len(scope_ids)
        result = []
        for key in keys:
            month_closes = OvertimeMonthService.closes_for(key, scope_ids)
            if supervisor is not None:
                item = OvertimeMonthService.status(
                    key, month_closes.get(supervisor.pk), holidays=holidays
                )
            else:
                item = OvertimeMonthService.status(key, None, holidays=holidays)
                item["supervisors_closed"] = len(month_closes)
                item["supervisors_total"] = total
                if total and len(month_closes) >= total:
                    item["status"] = OvertimeMonthService.CLOSED
            result.append(item)
            if item["status"] == OvertimeMonthService.OVERDUE:
                for team in active:
                    if team.pk not in month_closes:
                        OvertimeMonthService._warn_overdue(key, team, item)
        return result

    @staticmethod
    def pre_close_check(acc: NovedadesAccess, month: MonthKey, supervisor) -> dict:
        """Revisión previa al cierre del mes de un equipo. Solo informa: no
        bloquea, no corrige ni elimina nada. Reutiliza la misma validación
        con que se guarda cada fila (`OvertimeService.row_values`), así que no
        introduce reglas nuevas (no hay límites legales ni recargos)."""
        if not acc.can(perms.ACCEDER) or not acc.can_read_supervisor(supervisor.pk):
            raise _forbidden()
        records = list(
            OvertimeRecord.objects.filter(
                supervisor=supervisor,
                date__gte=month.start_date,
                date__lte=month.end_date,
                deleted_at__isnull=True,
            ).select_related("collaborator")
        )
        holidays = get_holiday_set()
        issues: list[dict] = []
        seen: dict[tuple, int] = {}
        for r in records:
            label = f"{r.collaborator.full_name} ({r.collaborator.cedula}) {r.date:%d/%m/%Y}"
            data = {f: getattr(r, f) for f in OVERTIME_FIELDS}
            _, errors = OvertimeService.row_values(data, r.date, is_holiday_day=r.date in holidays)
            for field, message in errors.items():
                issues.append(
                    {
                        "severity": "error",
                        "record_id": r.pk,
                        "label": label,
                        "message": f"{field}: {message}",
                        "fix": "Corríjalo en la captura antes de cerrar.",
                    }
                )
            if not month.contains(r.date):
                issues.append(
                    {
                        "severity": "error",
                        "record_id": r.pk,
                        "label": label,
                        "message": f"La fecha no pertenece a {month.label}.",
                        "fix": "Revise la fecha del registro.",
                    }
                )
            key = (r.collaborator_id, r.date)
            if key in seen:
                issues.append(
                    {
                        "severity": "error",
                        "record_id": r.pk,
                        "label": label,
                        "message": "Hay dos registros de la misma persona en la misma fecha.",
                        "fix": "Elimine el duplicado.",
                    }
                )
            seen[key] = r.pk
            if r.collaborator.current_supervisor_id != supervisor.pk:
                issues.append(
                    {
                        "severity": "warning",
                        "record_id": r.pk,
                        "label": label,
                        "message": "El colaborador ya pertenece a otro equipo (reasignado).",
                        "fix": "Es informativo: el registro se conserva con este equipo.",
                    }
                )
        pending_imports = [
            {
                "id": b.pk,
                "file_name": b.file_name,
                "uploaded_by": user_display(b.uploaded_by),
                "created_at": b.created_at,
                "invalid_rows": (b.summary or {}).get("invalid_rows", 0),
            }
            for b in ImportBatch.objects.filter(
                kind=ImportBatch.Kind.OVERTIME,
                status=ImportBatch.Status.PREVIEW,
                period__year=month.year,
                period__month=month.month,
            ).select_related("uploaded_by")
            if any(row.get("supervisor_id") == supervisor.pk for row in (b.rows or []))
        ]
        for b in pending_imports:
            issues.append(
                {
                    "severity": "warning",
                    "record_id": None,
                    "label": f"Importación «{b['file_name']}» de {b['uploaded_by']}",
                    "message": "Quedó en vista previa sin confirmar: sus filas NO están guardadas.",
                    "fix": "Confírmela o cancélela antes de cerrar.",
                }
            )
        return {
            "period": month.code,
            "supervisor_id": supervisor.pk,
            "records": len(records),
            "errors": sum(1 for i in issues if i["severity"] == "error"),
            "warnings": sum(1 for i in issues if i["severity"] == "warning"),
            "issues": issues[:200],
            "pending_imports": pending_imports,
        }

    @staticmethod
    def _warn_overdue(month: MonthKey, supervisor, item: dict) -> None:
        """Aviso único (deduplicado) al Administrador de un plazo vencido sin
        cierre. No hay tarea programada en el proyecto: se emite la primera vez
        que alguien consulta ese mes después del vencimiento."""
        NotificationService.notify_admins(
            f"Horas extras: venció el plazo de {month.label} para {user_display(supervisor)} "
            f"({item['deadline_label']}) y el mes sigue sin cerrar. Puede seguir editándose hasta "
            "que el supervisor o el Administrador pulse «Cerrar mes».",
            dedup_key=f"novedades:overtime-overdue:{supervisor.pk}:{month.code}",
        )

    @staticmethod
    def close(acc: NovedadesAccess, month: MonthKey, supervisor, *, context=None) -> dict:
        if not acc.can(perms.CERRAR):
            raise _forbidden("No tiene habilitado el cierre de períodos.")
        if not acc.can_write_for_supervisor(supervisor.pk):
            raise _forbidden()
        if not month < OvertimeMonthService.current_month():
            raise NovedadesError(
                f"{month.label} todavía está en curso: el mes de Horas extras se cierra cuando termina.",
                code="month_in_progress",
                status=409,
            )
        existing = OvertimeMonthClose.objects.filter(
            supervisor=supervisor, year=month.year, month=month.month
        ).first()
        if existing is not None:  # idempotente: repetir el cierre no crea nada
            return {"already_closed": True, **OvertimeMonthService.status(month, existing)}
        with transaction.atomic():
            # Mismo candado que `lock_and_check`: los guardados en curso del
            # equipo terminan antes de calcular el resumen y cerrar.
            list(User.objects.select_for_update().filter(pk=supervisor.pk).values_list("pk"))
            return OvertimeMonthService._close_locked(acc, month, supervisor, context=context)

    @staticmethod
    def _close_locked(acc: NovedadesAccess, month: MonthKey, supervisor, *, context=None) -> dict:
        existing = OvertimeMonthClose.objects.filter(
            supervisor=supervisor, year=month.year, month=month.month
        ).first()
        if existing is not None:
            return {"already_closed": True, **OvertimeMonthService.status(month, existing)}
        records = OvertimeRecord.objects.filter(
            supervisor=supervisor,
            date__gte=month.start_date,
            date__lte=month.end_date,
            deleted_at__isnull=True,
        ).aggregate(
            records=Count("pk"),
            collaborators=Count("collaborator", distinct=True),
            extra=Sum("overtime_hours"),
            saturday=Sum("saturday_hours"),
        )
        hours = OvertimeMonthService.grace_hours(month)
        deadline = OvertimeMonthService.deadline(month, hours=hours)
        summary = {
            "records": records["records"] or 0,
            "collaborators": records["collaborators"] or 0,
            "overtime_hours": _fmt(records["extra"] or Decimal("0")),
            "saturday_hours": _fmt(records["saturday"] or Decimal("0")),
            "grace_hours": hours,
            "deadline": deadline.isoformat(),
            "closed_after_deadline": timezone.now() >= deadline,
        }
        try:
            with transaction.atomic():
                close = OvertimeMonthClose.objects.create(
                    supervisor=supervisor,
                    year=month.year,
                    month=month.month,
                    closed_by=acc.user,
                    summary=summary,
                )
                EventService.log(
                    actor=acc.user,
                    action="overtime_month.closed",
                    supervisor=supervisor,
                    target_type="overtime_month",
                    target_id=close.pk,
                    target_label=f"Horas extras {month.label} — {user_display(supervisor)}",
                    new_value="CERRADO",
                    context=context,
                )
                NotificationService.notify_admins(
                    f"Horas extras: {user_display(acc.user)} cerró {month.label} del equipo de "
                    f"{user_display(supervisor)} ({summary['records']} registros, "
                    f"{summary['overtime_hours']} h extra, {summary['saturday_hours']} h sábado)"
                    + (" después del plazo." if summary["closed_after_deadline"] else "."),
                    exclude_user=acc.user,
                    dedup_key=f"novedades:overtime-month-closed:{close.pk}",
                )
        except IntegrityError:
            # Otra solicitud lo cerró entre la verificación y la escritura.
            close = OvertimeMonthClose.objects.get(
                supervisor=supervisor, year=month.year, month=month.month
            )
            return {"already_closed": True, **OvertimeMonthService.status(month, close)}
        return {
            "already_closed": False,
            "summary": summary,
            **OvertimeMonthService.status(month, close),
        }


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
            # Mes calendario de la fecha de trabajo (`MonthKey`), no el corte
            # 23 → 22: así un registro del 25/09 se consulta en septiembre.
            key = params["period"]
            qs = qs.filter(date__gte=key.start_date, date__lte=key.end_date)
        # Parámetros mal formados -> 400 con mensaje, no un error 500.
        if params.get("date"):
            qs = qs.filter(date=_parse_date_param(params["date"], "date"))
        if params.get("date_from"):
            qs = qs.filter(date__gte=_parse_date_param(params["date_from"], "date_from"))
        if params.get("date_to"):
            qs = qs.filter(date__lte=_parse_date_param(params["date_to"], "date_to"))
        if params.get("cedula"):
            qs = qs.filter(collaborator__cedula__icontains=normalize_cedula(params["cedula"]))
        if params.get("name"):
            qs = qs.filter(collaborator__full_name__icontains=params["name"].strip())
        for field in ("regional", "area", "cargo"):
            if params.get(field):
                qs = qs.filter(**{f"collaborator__{field}__icontains": params[field].strip()})
        if params.get("supervisor"):
            qs = qs.filter(supervisor_id=_parse_id_param(params["supervisor"], "supervisor"))
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
        month = OvertimeMonthService.assert_writable(supervisor, day)
        late = RecordDeadlineService.check(acc, RecordDeadlineService.OVERTIME, day)
        # `period` sigue apuntando al corte 23 → 22 de la fecha (dato de
        # referencia del modelo); el mes de Horas extras sale de `date`.
        legacy_period = PeriodService.get_period(period_for_date(day))
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
            OvertimeMonthService.lock_and_check(supervisor.pk, month)
            record = OvertimeRecord.objects.create(
                collaborator=collaborator,
                period=legacy_period,
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
                period=legacy_period,
                target_type="overtime",
                target_id=record.pk,
                target_label=f"{collaborator.full_name} ({collaborator.cedula}) {day:%d/%m/%Y}",
                new_value=f"{_fmt(values['overtime_hours'])} h extra / {_fmt(values['saturday_hours'])} h sábado",
                reason=RecordDeadlineService.LATE_REASON if late else "",
                source_file=source_file,
                context=context,
            )
            if notify:
                NotificationService.notify_admins(
                    f"Horas extras: {user_display(acc.user)} registró {_fmt(values['overtime_hours'])} h extra y "
                    f"{_fmt(values['saturday_hours'])} h de sábado para {collaborator.full_name} "
                    f"({collaborator.cedula}) el {day:%d/%m/%Y} — Horas extras de {month.label}.",
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
        OvertimeMonthService.assert_writable(record.supervisor, record.date)
        late = RecordDeadlineService.check(acc, RecordDeadlineService.OVERTIME, record.date)
        merged = {f: getattr(record, f) for f in OVERTIME_FIELDS}
        merged.update({k: v for k, v in data.items() if k in OVERTIME_FIELDS})
        values = OvertimeService._clean_values(merged, record.date)
        changed = {f: (getattr(record, f), v) for f, v in values.items() if getattr(record, f) != v}
        if not changed:
            return record
        with transaction.atomic():
            OvertimeMonthService.lock_and_check(record.supervisor_id, month_for_date(record.date))
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
                    reason=RecordDeadlineService.LATE_REASON if late else "",
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
        OvertimeMonthService.assert_writable(record.supervisor, record.date)
        late = RecordDeadlineService.check(acc, RecordDeadlineService.OVERTIME, record.date)
        if late and not reason:
            reason = RecordDeadlineService.LATE_REASON
        label = (
            f"{record.collaborator.full_name} ({record.collaborator.cedula}) {record.date:%d/%m/%Y}"
        )
        with transaction.atomic():
            OvertimeMonthService.lock_and_check(record.supervisor_id, month_for_date(record.date))
            # Borrado lógico condicional: si dos solicitudes llegan a la vez
            # (doble clic, reintento), solo una lo marca; la otra recibe 404 y
            # no deja evento ni alerta duplicados.
            record.deleted_at = timezone.now()
            record.deleted_by = acc.user
            marked = OvertimeRecord.objects.filter(pk=record.pk, deleted_at__isnull=True).update(
                deleted_at=record.deleted_at, deleted_by=acc.user
            )
            if not marked:
                raise _not_found("El registro ya fue eliminado.")
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
                f"Registro de horas extras eliminado: {record.collaborator.full_name} "
                f"(cédula {record.collaborator.cedula}) — {record.date:%d/%m/%Y}, Horas extras de "
                f"{month_for_date(record.date).label}, {_fmt(record.overtime_hours)} h extra / "
                f"{_fmt(record.saturday_hours)} h sábado. Eliminado por {user_display(acc.user)} el "
                f"{business_stamp()}. El colaborador sigue en la base."
                + (f" Motivo: {reason}." if reason else ""),
                exclude_user=acc.user,
                category=ALERT_DELETION,
                dedup_key=f"novedades:overtime-deleted:{record.pk}",
            )

    BULK_LIMIT = 500

    @staticmethod
    def bulk_save(
        acc: NovedadesAccess,
        key: MonthKey,
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
        if not acc.can(perms.REGISTRAR):
            raise _forbidden("No tiene habilitado el registro de novedades.")
        if not rows:
            raise NovedadesError("No hay filas para guardar.")
        if OvertimeMonthService.current_month() < key:
            raise NovedadesError(
                f"{key.label} todavía no empieza: no se registran horas extras de meses futuros.",
                code="period_not_open",
            )
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
        # Mes cerrado manualmente para el equipo = bloqueado (no hay cierre
        # automático: vencido el plazo, solo se avisa).
        closed_supervisors = OvertimeMonthService.closed_supervisor_ids(key, supervisor_ids)
        deadline_holidays = get_holiday_set()
        legacy_periods: dict[tuple, OperationalPeriod] = {}

        def legacy_period(day):
            pk = period_for_date(day)
            if (pk.year, pk.month) not in legacy_periods:
                legacy_periods[(pk.year, pk.month)] = PeriodService.get_period(pk)
            return legacy_periods[(pk.year, pk.month)]

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
            # Plazo por fecha de trabajo (y fecha futura): la nueva fecha y, si
            # se mueve un registro, también la original.
            try:
                late = RecordDeadlineService.check(
                    acc, RecordDeadlineService.OVERTIME, day, holidays=deadline_holidays
                )
                if record is not None and record.date != day:
                    late = (
                        RecordDeadlineService.check(
                            acc,
                            RecordDeadlineService.OVERTIME,
                            record.date,
                            holidays=deadline_holidays,
                        )
                        or late
                    )
            except NovedadesError as exc:
                fail(
                    row,
                    "locked" if exc.code == "deadline_passed" else "error",
                    {"date": exc.message},
                )
                continue
            if supervisor_id in closed_supervisors:
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
                if (
                    row.get("version") is not None
                    and int(row["version"]) != record.version
                    and record.date == day
                    and all(getattr(record, f) == v for f, v in values.items())
                ):
                    # Reintento de una edición que ya se aplicó (respuesta
                    # perdida por la red): no es un conflicto.
                    results.append(
                        {
                            "client_key": client_key,
                            "status": "unchanged",
                            "errors": {},
                            "record_id": record.pk,
                            "version": record.version,
                        }
                    )
                    continue
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
                    {
                        "row": row,
                        "record": record,
                        "collaborator": collaborator,
                        "values": values,
                        "late": late,
                    },
                )
            )
            results.append({"client_key": client_key, "status": "pending", "errors": {}})

        created = updated = unchanged = 0
        late_ids: set[int] = set()
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
                    OvertimeMonthService.lock_and_check(
                        record.supervisor_id if record else collaborator.current_supervisor_id,
                        key,
                    )
                    if record is None:
                        new = OvertimeRecord.objects.create(
                            collaborator=collaborator,
                            period=legacy_period(day),
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
                                day,
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
                        if item["late"]:
                            late_ids.add(new.pk)
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
                        period=legacy_period(day),
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
                                day,
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
                    if item["late"]:
                        late_ids.add(record.pk)
            except NovedadesError as exc:
                results[index] = {
                    "client_key": row.get("client_key"),
                    "status": "locked" if exc.code == "period_closed" else "conflict",
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
                    period=legacy_period(day),
                    target_type="overtime",
                    target_id=str(rid),
                    target_label=label[:255],
                    field=field,
                    old_value=_fmt(old)[:1000],
                    new_value=_fmt(new)[:1000],
                    reason=RecordDeadlineService.LATE_REASON if rid in late_ids else "",
                    source_file=source_file[:255],
                )
                for action, sid, rid, label, field, old, new, day in events
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
                target_id=key.code,
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
            # Misma regla del correo de ingreso que la edición ordinaria.
            transaction.on_commit(lambda: EntryNotificationService.check({collaborator.pk}))
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
        month = month_for_date(record.date)
        if not OvertimeMonthClose.objects.filter(
            supervisor=record.supervisor, year=month.year, month=month.month
        ).exists():
            raise NovedadesError(
                f"{month.label} de Horas extras no está cerrado para {user_display(record.supervisor)}: "
                "use la edición ordinaria.",
                code="period_open",
                status=409,
            )
        # El registro de corrección guarda el mes afectado (mismo año/mes).
        affected_period = PeriodService.get_period(PeriodKey(month.year, month.month))
        with transaction.atomic():
            # Bloqueado y releído: dos correcciones simultáneas no se pisan.
            record = (
                OvertimeRecord.objects.select_for_update()
                .select_related("collaborator", "supervisor", "period")
                .filter(pk=record.pk, deleted_at__isnull=True)
                .first()
            )
            if record is None:
                raise _not_found("El registro ya fue eliminado.")
            original = {f: _fmt(getattr(record, f)) for f in OVERTIME_FIELDS}
            if delete:
                record.deleted_at = timezone.now()
                record.deleted_by = acc.user
                marked = OvertimeRecord.objects.filter(
                    pk=record.pk, deleted_at__isnull=True
                ).update(deleted_at=record.deleted_at, deleted_by=acc.user)
                if not marked:  # otra solicitud lo eliminó primero
                    raise _not_found("El registro ya fue eliminado.")
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
                period=affected_period,
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
                period=record.period,
                target_type="overtime",
                target_id=record.pk,
                target_label=f"{record.collaborator.full_name} ({record.collaborator.cedula}) {record.date:%d/%m/%Y}",
                old_value=str(original),
                new_value=str(new_values),
                reason=reason.strip(),
                context=context,
            )
            if delete:
                NotificationService.notify_admins(
                    f"Registro de horas extras eliminado (corrección de período cerrado): "
                    f"{record.collaborator.full_name} (cédula {record.collaborator.cedula}) — "
                    f"{record.date:%d/%m/%Y}, Horas extras de {month.label}. Eliminado por "
                    f"{user_display(acc.user)} el {business_stamp()}. Motivo: {reason.strip()}. "
                    "El colaborador sigue en la base.",
                    exclude_user=acc.user,
                    category=ALERT_DELETION,
                    dedup_key=f"novedades:overtime-deleted:{record.pk}",
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
        if not acc.can_view_event_history:
            raise _forbidden(
                "El historial de registros solo lo consultan el Administrador y el "
                "Asistente de Operaciones."
            )
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
            start, end = business_range(key.start_date, key.end_date)
            qs = qs.filter(
                Q(period__year=key.year, period__month=key.month)
                | Q(period__isnull=True, created_at__gte=start, created_at__lt=end)
            )
        if params.get("supervisor"):
            qs = qs.filter(supervisor_id=_parse_id_param(params["supervisor"], "supervisor"))
        if params.get("action"):
            qs = qs.filter(action__startswith=params["action"])
        if params.get("q"):
            qs = qs.filter(target_label__icontains=params["q"].strip())
        # Desde/Hasta son días de Ecuador (UTC-5), no días UTC: un evento de
        # las 20:00 pertenece a su día local.
        if params.get("date_from"):
            first = _parse_date_param(params["date_from"], "date_from")
            start, _ = business_range(first, first)
            qs = qs.filter(created_at__gte=start)
        if params.get("date_to"):
            last = _parse_date_param(params["date_to"], "date_to")
            _, end = business_range(last, last)
            qs = qs.filter(created_at__lt=end)
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


# ── Horas depuradas (copia independiente del consolidado) ─────────────────────


DEPURABLE_FIELDS = (
    "overtime_hours",
    "saturday_hours",
    "is_saturday",
    "is_sunday",
    "is_holiday",
    "work_done",
    "observations",
)


def _raw(value):
    return value if isinstance(value, bool) else _fmt(value)


class DepurationService:
    """Base de Horas depuradas del Jefe de Operaciones (pedido del 2026-10-13).

    - Se crea a partir del consolidado de Horas extras (los `OvertimeRecord`
      vigentes del mes calendario, todos los equipos) en una acción explícita
      y solo para meses terminados. Una sola por mes: la restricción única de
      la base lo garantiza aunque lleguen dos solicitudes simultáneas, y crearla
      de nuevo devuelve la existente sin tocar sus ajustes.
    - Es una COPIA: ninguna operación de este servicio escribe en
      `OvertimeRecord`. Cambios posteriores en el origen no la sobrescriben; se
      señalan como diferencias.
    - Edita solo el Jefe de Operaciones; el Administrador consulta y exporta.
    - Cada cambio queda en `DepurationChange` (original, anterior, nuevo,
      responsable, fecha y motivo) y en la auditoría general."""

    @staticmethod
    def _check_view(acc: NovedadesAccess) -> None:
        if not acc.can_view_depuration:
            raise _forbidden("No tiene acceso a Horas depuradas.")

    @staticmethod
    def _check_edit(acc: NovedadesAccess) -> None:
        if not acc.can_depurate:
            raise _forbidden("Solo el Jefe de Operaciones modifica la base de Horas depuradas.")

    @staticmethod
    def get(month: MonthKey):
        return OvertimeDepuration.objects.filter(year=month.year, month=month.month).first()

    @staticmethod
    def _source(month: MonthKey):
        return OvertimeRecord.objects.filter(
            date__gte=month.start_date, date__lte=month.end_date, deleted_at__isnull=True
        ).select_related("collaborator", "supervisor")

    @staticmethod
    def _source_summary(month: MonthKey) -> dict:
        totals = DepurationService._source(month).aggregate(
            records=Count("pk"), extra=Sum("overtime_hours"), saturday=Sum("saturday_hours")
        )
        supervisors = list(PeriodService.supervisors())
        closes = OvertimeMonthService.closes_for(month, [s.pk for s in supervisors])
        return {
            "records": totals["records"] or 0,
            "overtime_hours": totals["extra"] or Decimal("0"),
            "saturday_hours": totals["saturday"] or Decimal("0"),
            "supervisors_total": len(supervisors),
            "supervisors_closed": len(closes),
        }

    @staticmethod
    def status(acc: NovedadesAccess, month: MonthKey) -> dict:
        DepurationService._check_view(acc)
        source = DepurationService._source_summary(month)
        depuration = DepurationService.get(month)
        ended = month < OvertimeMonthService.current_month()
        data = {
            "period": month.code,
            "label": month.label,
            "exists": depuration is not None,
            "can_create": acc.can_depurate and depuration is None and ended,
            "can_edit": acc.can_depurate,
            "month_ended": ended,
            "source": {
                "records": source["records"],
                "overtime_hours": _fmt(source["overtime_hours"]),
                "saturday_hours": _fmt(source["saturday_hours"]),
                "supervisors_total": source["supervisors_total"],
                "supervisors_closed": source["supervisors_closed"],
            },
        }
        if depuration is not None:
            rows = depuration.rows.all()
            active = rows.filter(excluded=False)
            totals = active.aggregate(extra=Sum("overtime_hours"), saturday=Sum("saturday_hours"))
            last = depuration.changes.select_related("actor").first()
            data["depuration"] = {
                "id": depuration.pk,
                "created_at": depuration.created_at,
                "created_by": user_display(depuration.created_by),
                "source_count": depuration.source_count,
                "source_overtime_hours": _fmt(depuration.source_overtime_hours),
                "source_saturday_hours": _fmt(depuration.source_saturday_hours),
                "supervisors_total": depuration.supervisors_total,
                "supervisors_closed": depuration.supervisors_closed,
                "rows": rows.count(),
                "excluded": rows.filter(excluded=True).count(),
                "modified": sum(1 for r in rows if DepurationService._is_modified(r)),
                "overtime_hours": _fmt(totals["extra"] or Decimal("0")),
                "saturday_hours": _fmt(totals["saturday"] or Decimal("0")),
                "last_change_at": last.created_at if last else None,
                "last_change_by": user_display(last.actor) if last else "",
            }
        return data

    @staticmethod
    def create(acc: NovedadesAccess, month: MonthKey, *, context=None) -> dict:
        DepurationService._check_edit(acc)
        existing = DepurationService.get(month)
        if existing is not None:
            # Idempotente: abrir de nuevo devuelve la MISMA base, con sus ajustes.
            return {"created": False, **DepurationService.status(acc, month)}
        if not month < OvertimeMonthService.current_month():
            raise NovedadesError(
                f"{month.label} todavía está en curso: la base depurable se crea con el mes terminado.",
                code="month_in_progress",
                status=409,
            )
        source = DepurationService._source_summary(month)
        try:
            with transaction.atomic():
                depuration = OvertimeDepuration.objects.create(
                    year=month.year,
                    month=month.month,
                    created_by=acc.user,
                    source_count=source["records"],
                    source_overtime_hours=source["overtime_hours"],
                    source_saturday_hours=source["saturday_hours"],
                    supervisors_total=source["supervisors_total"],
                    supervisors_closed=source["supervisors_closed"],
                )
                copies = []
                for r in DepurationService._source(month):
                    values = {f: getattr(r, f) for f in DEPURABLE_FIELDS}
                    copies.append(
                        DepuratedOvertime(
                            depuration=depuration,
                            source_record=r,
                            source_id=r.pk,
                            collaborator=r.collaborator,
                            supervisor=r.supervisor,
                            date=r.date,
                            cedula=r.collaborator.cedula,
                            full_name=r.collaborator.full_name,
                            regional=r.collaborator.regional,
                            area=r.collaborator.area,
                            cargo=r.collaborator.cargo,
                            supervisor_name=user_display(r.supervisor),
                            **{f"orig_{f}": v for f, v in values.items()},
                            **values,
                        )
                    )
                DepuratedOvertime.objects.bulk_create(copies, batch_size=500)
                # La fotografía debe coincidir con lo copiado.
                if len(copies) != source["records"]:
                    depuration.source_count = len(copies)
                    depuration.save(update_fields=["source_count"])
                EventService.log(
                    actor=acc.user,
                    action="depuration.created",
                    target_type="overtime_depuration",
                    target_id=depuration.pk,
                    target_label=f"Horas depuradas {month.label}",
                    new_value=f"{len(copies)} registros copiados del consolidado",
                    context=context,
                )
        except IntegrityError:
            # Otra solicitud la creó entre la verificación y la escritura.
            return {"created": False, **DepurationService.status(acc, month)}
        return {"created": True, **DepurationService.status(acc, month)}

    @staticmethod
    def _is_modified(row: DepuratedOvertime) -> bool:
        return row.excluded or any(
            getattr(row, f) != getattr(row, f"orig_{f}") for f in DEPURABLE_FIELDS
        )

    @staticmethod
    def rows(acc: NovedadesAccess, month: MonthKey, params: dict | None = None) -> list[dict]:
        DepurationService._check_view(acc)
        depuration = DepurationService.get(month)
        if depuration is None:
            return []
        params = params or {}
        qs = depuration.rows.select_related("source_record")
        if params.get("supervisor"):
            qs = qs.filter(supervisor_id=_parse_id_param(params["supervisor"], "supervisor"))
        if params.get("q"):
            needle = str(params["q"]).strip()
            qs = qs.filter(Q(full_name__icontains=needle) | Q(cedula__icontains=needle))
        result = []
        for r in qs:
            src = r.source_record
            # Diferencias del ORIGEN actual frente a la fotografía (no se
            # aplican solas: solo se señalan).
            if src is None or src.deleted_at is not None:
                source_state = "deleted"
            elif any(getattr(src, f) != getattr(r, f"orig_{f}") for f in DEPURABLE_FIELDS):
                source_state = "changed"
            else:
                source_state = ""
            result.append(
                {
                    "id": r.pk,
                    "source_id": r.source_id,
                    "version": r.version,
                    "date": r.date,
                    "cedula": r.cedula,
                    "full_name": r.full_name,
                    "regional": r.regional,
                    "area": r.area,
                    "cargo": r.cargo,
                    "supervisor_id": r.supervisor_id,
                    "supervisor_name": r.supervisor_name,
                    "excluded": r.excluded,
                    "modified": DepurationService._is_modified(r),
                    "source_state": source_state,
                    # Marcas como booleanos (la pantalla las edita); el resto como texto.
                    "original": {f: _raw(getattr(r, f"orig_{f}")) for f in DEPURABLE_FIELDS},
                    "current": {f: _raw(getattr(r, f)) for f in DEPURABLE_FIELDS},
                    "difference_hours": _fmt(
                        (r.overtime_hours + r.saturday_hours)
                        - (r.orig_overtime_hours + r.orig_saturday_hours)
                    ),
                }
            )
        return result

    @staticmethod
    def save_rows(acc: NovedadesAccess, month: MonthKey, rows: list[dict], *, context=None) -> dict:
        """Guardado (automático) de filas depuradas. Resultado por fila; una
        fila inválida no impide guardar las demás. Control de versión: una
        respuesta atrasada nunca pisa una edición más reciente."""
        DepurationService._check_edit(acc)
        depuration = DepurationService.get(month)
        if depuration is None:
            raise _not_found("Todavía no existe la base depurable de este mes.")
        if len(rows) > OvertimeService.BULK_LIMIT:
            raise NovedadesError("Demasiadas filas en un solo envío.", code="batch_too_large")
        by_id = {
            r.pk: r
            for r in depuration.rows.filter(pk__in=[row.get("id") for row in rows if row.get("id")])
        }
        results = []
        for row in rows:
            key = row.get("client_key") or str(row.get("id"))
            record = by_id.get(row.get("id"))
            if record is None:
                results.append(
                    {
                        "client_key": key,
                        "status": "error",
                        "errors": {"row": "La fila no existe en esta base."},
                    }
                )
                continue
            changes: dict[str, object] = {}
            errors: dict[str, str] = {}
            merged = {f: getattr(record, f) for f in DEPURABLE_FIELDS}
            merged.update({f: row[f] for f in DEPURABLE_FIELDS if f in row})
            values, field_errors = OvertimeService.row_values(merged, record.date)
            if field_errors:
                errors.update(field_errors)
            else:
                for f, v in values.items():
                    if getattr(record, f) != v:
                        changes[f] = v
            if "excluded" in row:
                if not isinstance(row["excluded"], bool):
                    errors["excluded"] = "Valor inválido."
                elif row["excluded"] != record.excluded:
                    changes["excluded"] = row["excluded"]
            if errors:
                results.append({"client_key": key, "status": "error", "errors": errors})
                continue
            if row.get("version") is not None and int(row["version"]) != record.version:
                same = all(getattr(record, f) == v for f, v in changes.items()) or not changes
                status = "unchanged" if same else "conflict"
                results.append(
                    {
                        "client_key": key,
                        "status": status,
                        "errors": (
                            {} if same else {"row": "Otro usuario modificó esta fila; recargue."}
                        ),
                        "id": record.pk,
                        "version": record.version,
                    }
                )
                continue
            if not changes:
                results.append(
                    {
                        "client_key": key,
                        "status": "unchanged",
                        "errors": {},
                        "id": record.pk,
                        "version": record.version,
                    }
                )
                continue
            reason = str(row.get("reason") or "").strip()[:500]
            with transaction.atomic():
                updated = DepuratedOvertime.objects.filter(
                    pk=record.pk, version=record.version
                ).update(
                    **changes,
                    version=record.version + 1,
                    updated_by=acc.user,
                    updated_at=timezone.now(),
                )
                if not updated:
                    results.append(
                        {
                            "client_key": key,
                            "status": "conflict",
                            "errors": {"row": "Otro usuario modificó esta fila; recargue."},
                        }
                    )
                    continue
                DepurationChange.objects.bulk_create(
                    [
                        DepurationChange(
                            depuration=depuration,
                            row=record,
                            field=f,
                            original_value=(
                                _fmt(getattr(record, f"orig_{f}"))
                                if f != "excluded"
                                else _fmt(False)
                            ),
                            old_value=_fmt(getattr(record, f)),
                            new_value=_fmt(v),
                            reason=reason,
                            actor=acc.user,
                        )
                        for f, v in changes.items()
                    ]
                )
                record_audit_event(
                    actor=acc.user,
                    action="novedades.depuration.row_updated",
                    target_type="depurated_overtime",
                    target_id=record.pk,
                    module=MODULE,
                    previous_values={f: _fmt(getattr(record, f)) for f in changes},
                    new_values={f: _fmt(v) for f, v in changes.items()},
                    context=context,
                )
            results.append(
                {
                    "client_key": key,
                    "status": "updated",
                    "errors": {},
                    "id": record.pk,
                    "version": record.version + 1,
                }
            )
        return {"rows": results}

    @staticmethod
    def history(acc: NovedadesAccess, month: MonthKey, row_id=None) -> list[dict]:
        DepurationService._check_view(acc)
        depuration = DepurationService.get(month)
        if depuration is None:
            return []
        qs = depuration.changes.select_related("actor", "row")
        if row_id:
            qs = qs.filter(row_id=_parse_id_param(row_id, "row"))
        return [
            {
                "id": c.pk,
                "row_id": c.row_id,
                "label": f"{c.row.full_name} ({c.row.cedula}) {c.row.date:%d/%m/%Y}",
                "field": c.field,
                "original_value": c.original_value,
                "old_value": c.old_value,
                "new_value": c.new_value,
                "reason": c.reason,
                "actor": user_display(c.actor),
                "created_at": c.created_at,
            }
            for c in qs[:500]
        ]

    @staticmethod
    def export_rows(acc: NovedadesAccess, month: MonthKey):
        DepurationService._check_view(acc)
        if not (acc.can_depurate or acc.can(perms.EXPORTAR)):
            raise _forbidden("No tiene habilitada la exportación.")
        depuration = DepurationService.get(month)
        if depuration is None:
            raise _not_found("Todavía no existe la base depurable de este mes.")
        return depuration, depuration.rows.filter(excluded=False).order_by(
            "date", "full_name", "pk"
        )


# ── Notificaciones de colaboradores por correo (ingreso y salida) ────────────


def _admin_only(acc: NovedadesAccess):
    """Ajustes de NEXO: solo el rol Administrador (`is_superuser`, el mismo
    criterio que `apps.core.permissions.IsAdministrador`)."""
    if not acc.user.is_superuser:
        raise _forbidden(
            "Solo el Administrador puede gestionar las notificaciones de colaboradores."
        )


def _normalize_email(value) -> str:
    return "".join(str(value or "").split()).lower()


RecipientKind = CollaboratorNotificationRecipient.Kind
# Nombre técnico (auditoría) y nombre de la lista (mensajes) por tipo.
KIND_LABELS = {RecipientKind.ENTRY: "ingreso", RecipientKind.EXIT: "salida"}
LIST_NAMES = {RecipientKind.ENTRY: "ingresos", RecipientKind.EXIT: "cambios de estado"}


class NotificationRecipientService:
    """Destinatarios por tipo de correo (Ajustes → Notificaciones de
    colaboradores). Cada tipo tiene su propia lista: una dirección de la lista
    de ingresos no recibe salidas salvo que también esté en esa lista.
    Persisten en la base; nunca se borran, se desactivan."""

    @staticmethod
    def _kind(value) -> str:
        kind = str(value or "").strip().upper()
        if kind not in RecipientKind.values:
            raise NovedadesError(
                "Indique el tipo de notificación (ingreso o salida).",
                details={"kind": "Valor inválido."},
            )
        return kind

    @staticmethod
    def _validate_email(kind: str, email: str, *, exclude_pk=None) -> str:
        from django.core.exceptions import ValidationError
        from django.core.validators import validate_email

        email = _normalize_email(email)
        if not email:
            raise NovedadesError(
                "Indique la dirección de correo.", details={"email": "Obligatorio."}
            )
        try:
            validate_email(email)
        except ValidationError as exc:
            raise NovedadesError(
                "La dirección de correo no es válida.", details={"email": "Formato inválido."}
            ) from exc
        duplicate = CollaboratorNotificationRecipient.objects.filter(kind=kind, email=email)
        if exclude_pk is not None:
            duplicate = duplicate.exclude(pk=exclude_pk)
        if duplicate.exists():
            raise NovedadesError(
                f"{email} ya está en la lista de {LIST_NAMES[kind]}.",
                code="duplicate",
                status=409,
                details={"email": "Duplicado."},
            )
        return email

    @staticmethod
    def _area(value) -> str:
        area = str(value or "").strip()
        if area and area not in CollaboratorNotificationRecipient.Area.values:
            raise NovedadesError("Área inválida.", details={"area": "Valor inválido."})
        return area

    @staticmethod
    def serialize(r: CollaboratorNotificationRecipient) -> dict:
        return {
            "id": r.pk,
            "kind": r.kind,
            "email": r.email,
            "area": r.area,
            "area_label": r.get_area_display() if r.area else "",
            "is_active": r.is_active,
            "updated_at": r.updated_at,
            "updated_by": user_display(r.updated_by),
        }

    @staticmethod
    def active_emails(kind: str) -> list[str]:
        return list(
            CollaboratorNotificationRecipient.objects.filter(kind=kind, is_active=True)
            .order_by("email")
            .values_list("email", flat=True)
        )

    @staticmethod
    def config(acc: NovedadesAccess) -> dict:
        _admin_only(acc)
        recipients = list(CollaboratorNotificationRecipient.objects.select_related("updated_by"))
        # Solo el TIPO de envío (SMTP real o consola de desarrollo): nunca el
        # servidor, el usuario ni la contraseña.
        backend = settings.EMAIL_BACKEND.lower()
        delivery = "smtp" if "smtp" in backend else "console" if "console" in backend else "other"
        return {
            "recipients": [NotificationRecipientService.serialize(r) for r in recipients],
            "active_count": {
                kind: sum(1 for r in recipients if r.kind == kind and r.is_active)
                for kind in RecipientKind.values
            },
            "delivery": delivery,
            "areas": [
                {"value": value, "label": label}
                for value, label in CollaboratorNotificationRecipient.Area.choices
            ],
        }

    @staticmethod
    def create(acc: NovedadesAccess, data: dict, *, context=None) -> dict:
        _admin_only(acc)
        kind = NotificationRecipientService._kind(data.get("kind"))
        email = NotificationRecipientService._validate_email(kind, data.get("email"))
        area = NotificationRecipientService._area(data.get("area"))
        try:
            with transaction.atomic():
                r = CollaboratorNotificationRecipient.objects.create(
                    kind=kind, email=email, area=area, created_by=acc.user, updated_by=acc.user
                )
        except IntegrityError as exc:  # dos altas simultáneas de la misma dirección
            raise NovedadesError(
                f"{email} ya está en la lista de {LIST_NAMES[kind]}.",
                code="duplicate",
                status=409,
            ) from exc
        record_audit_event(
            actor=acc.user,
            action="novedades.notification_recipient.created",
            module=MODULE,
            target_type="notification_recipient",
            target_id=r.pk,
            new_values={"kind": kind, "email": email, "area": area, "is_active": True},
            context=context,
        )
        return NotificationRecipientService.serialize(r)

    @staticmethod
    def update(acc: NovedadesAccess, pk, data: dict, *, context=None) -> dict:
        _admin_only(acc)
        r = CollaboratorNotificationRecipient.objects.filter(pk=pk).first()
        if r is None:
            raise _not_found("Destinatario no encontrado.")
        old = {"kind": r.kind, "email": r.email, "area": r.area, "is_active": r.is_active}
        if "email" in data:
            r.email = NotificationRecipientService._validate_email(
                r.kind, data["email"], exclude_pk=r.pk
            )
        if "area" in data:
            r.area = NotificationRecipientService._area(data["area"])
        if "is_active" in data:
            if not isinstance(data["is_active"], bool):
                raise NovedadesError("Valor inválido.", details={"is_active": "Use Sí o No."})
            r.is_active = data["is_active"]
        new = {"kind": r.kind, "email": r.email, "area": r.area, "is_active": r.is_active}
        if new == old:
            return NotificationRecipientService.serialize(r)
        r.updated_by = acc.user
        try:
            with transaction.atomic():
                r.save()
        except IntegrityError as exc:
            raise NovedadesError(
                f"{r.email} ya está en la lista de {LIST_NAMES[r.kind]}.",
                code="duplicate",
                status=409,
            ) from exc
        record_audit_event(
            actor=acc.user,
            action="novedades.notification_recipient.updated",
            module=MODULE,
            target_type="notification_recipient",
            target_id=r.pk,
            previous_values=old,
            new_values=new,
            context=context,
        )
        return NotificationRecipientService.serialize(r)


class CollaboratorMailService:
    """Motor común de los correos de ingreso y de salida.

    - Reutiliza el envío de correo de NEXO: `EMAIL_BACKEND` y credenciales de
      `backend/.env`, remitente `DEFAULT_FROM_EMAIL` (los mismos del correo de
      recuperación de contraseña). No hay un cliente SMTP propio.
    - Un correo INDIVIDUAL por destinatario, con su estado propio en el evento
      (`recipients`): un reintento solo envía a quienes todavía no lo
      recibieron, nunca repite a quien ya lo recibió.
    - El envío se "reclama" con una actualización condicional (Pendiente o
      Fallido → Enviando): dos procesos nunca envían el mismo evento a la vez.
    - "Enviado" significa que el servidor SMTP ACEPTÓ el mensaje; no garantiza
      que llegó a la bandeja ni que alguien lo leyó.
    - Una falla del correo nunca revierte la operación que lo originó: el
      evento queda Fallido y se reintenta (`novedades_retry_notifications` o
      el botón Reintentar de Ajustes)."""

    # En tests se pone en False (conftest): el envío corre en el mismo hilo.
    run_async = True
    MAX_AUTO_ATTEMPTS = 5
    STALE_SENDING = timedelta(minutes=15)
    STALE_PENDING = timedelta(minutes=2)
    NO_RECIPIENTS = "No hay destinatarios activos configurados en Ajustes."

    @staticmethod
    def handler(kind: str):
        return EntryNotificationService if kind == RecipientKind.ENTRY else ExitNotificationService

    # ── Detalle de asistencia (común) ─────────────────────────────────────
    @staticmethod
    def attendance(collaborator, supervisor, period) -> dict:
        """Fila del colaborador en Días laborados para el período, leída de la
        base persistida con la MISMA lógica de la matriz (columnas, celdas y
        total). Solo lee: no modifica ningún registro."""
        key = period.key
        holidays = WorkedDayService._holidays(key)
        row_cells = (
            WorkedDayService.cells(period, [collaborator], supervisor).get(collaborator.pk, {})
            if supervisor is not None
            else {}
        )
        columns, values = [], []
        for d in key.dates():
            iso = d.isoformat()
            cell = row_cells.get(iso)
            columns.append(
                {
                    "date": iso,
                    "day": d.day,
                    "weekday": WEEKDAY_NAMES_ES[d.weekday()],
                    "is_weekend": is_weekend(d),
                    "holiday": holidays.get(d, ""),
                }
            )
            values.append(
                {
                    "hours": cell["hours"] if cell else None,
                    "other_team": cell.get("other_team", "") if cell else "",
                }
            )
        return {
            "collaborator": {
                "id": collaborator.pk,
                "cedula": collaborator.cedula,
                "full_name": collaborator.full_name,
                "cargo": collaborator.cargo,
            },
            "supervisor": user_display(supervisor),
            "period": {
                "code": key.code,
                "label": key.label,
                "start_date": key.start_date.isoformat(),
                "end_date": key.end_date.isoformat(),
            },
            "columns": columns,
            "values": values,
            "total": _fmt(WorkedDayService.row_total(row_cells)),
        }

    @staticmethod
    def schedule(kind: str, event_id: int) -> None:
        """Envía sin hacer esperar a quien guardó: la operación ya está
        confirmada y el correo corre en segundo plano. Si el proceso se
        reinicia antes de enviar, el evento queda Pendiente y lo retoma el
        reintento programado."""
        if not CollaboratorMailService.run_async:
            CollaboratorMailService.deliver(kind, event_id)
            return

        def _run():
            try:
                CollaboratorMailService.deliver(kind, event_id)
            except Exception:  # noqa: BLE001
                logger.exception("Falla inesperada al enviar el correo %s %s", kind, event_id)
            finally:
                close_old_connections()

        threading.Thread(target=_run, name=f"mail-{kind}-{event_id}", daemon=True).start()

    # ── Correo ─────────────────────────────────────────────────────────────
    @staticmethod
    def render(kind: str, snapshot: dict) -> tuple[str, str]:
        """(texto plano, HTML) con la plantilla común. Todo valor dinámico pasa
        por el autoescape de Django."""
        content = CollaboratorMailService.handler(kind).content(snapshot)
        columns = [
            {**c, "weekday_short": c["weekday"][:3], "value": v}
            for c, v in zip(snapshot["columns"], snapshot["values"], strict=True)
        ]
        system = settings.SYSTEM_NAME.upper()
        context = {
            "system_name": system,
            "s": snapshot,
            "columns": columns,
            "has_other_team": any(v["other_team"] for v in snapshot["values"]),
            **content,
        }
        html = render_to_string("emails/collaborator_notification.html", context)
        days = "\n".join(
            f"  {col['day']:02d} {col['weekday'][:3]}: "
            f"{col['value']['hours'] if col['value']['hours'] is not None else '—'}"
            for col in columns
        )
        info = "\n".join(f"{label}: {value}" for label, value in content["info_rows"])
        text = (
            f"{system} — {content['title']}\n\n{content['message']}\n\n{info}\n\n"
            f"Días laborados — {snapshot['period']['label']} (— = sin registro):\n{days}\n"
            f"Total: {snapshot['total']}\n\n{content['footer']}\n"
        )
        return text, html

    @staticmethod
    def subject(kind: str, snapshot: dict) -> str:
        name = " ".join(str(snapshot["collaborator"]["full_name"]).split())  # sin saltos de línea
        title = CollaboratorMailService.handler(kind).subject_title(snapshot)
        return f"{settings.SYSTEM_NAME.upper()} | {title} — {name}"

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        """Mensaje técnico sin secretos: nunca la contraseña ni el usuario SMTP."""
        message = f"{type(exc).__name__}: {exc}"
        for secret in (settings.EMAIL_HOST_PASSWORD, settings.EMAIL_HOST_USER):
            if secret:
                message = message.replace(secret, "***")
        return message[:480]

    @staticmethod
    def _state(raw) -> list[dict]:
        """Estado por destinatario (`[{email, status, sent_at, error}]`)."""
        return [dict(r) for r in raw or [] if isinstance(r, dict)]

    @staticmethod
    def deliver(kind: str, event_id: int):
        handler = CollaboratorMailService.handler(kind)
        Model = handler.MODEL
        S = Model.Status
        now = timezone.now()
        # Reclamo atómico: solo un proceso pasa de Pendiente/Fallido a Enviando.
        claimed = Model.objects.filter(pk=event_id, status__in=[S.PENDING, S.FAILED]).update(
            status=S.SENDING, attempts=F("attempts") + 1, last_attempt_at=now
        )
        event = Model.objects.select_related(*handler.RELATED).filter(pk=event_id).first()
        if not claimed or event is None:
            return event  # ya enviado, en espera o en curso: nunca un segundo envío

        state = CollaboratorMailService._state(event.recipients)

        def finish(status, error=""):
            event.status = status
            event.last_error = error
            event.recipients = state
            if status == S.SENT:
                event.sent_at = timezone.now()
            event.save(update_fields=["status", "last_error", "recipients", "sent_at", "snapshot"])
            handler.log(event)
            return event

        already = {r["email"] for r in state if r["status"] == "SENT"}
        targets = [e for e in NotificationRecipientService.active_emails(kind) if e not in already]
        if not targets:
            if already:
                return finish(S.SENT)
            return finish(S.FAILED, CollaboratorMailService.NO_RECIPIENTS)
        if event.snapshot is None:
            try:
                event.snapshot = handler.build_snapshot(event)
            except Exception as exc:  # noqa: BLE001
                logger.exception("No se pudo leer el detalle de asistencia (%s %s)", kind, event_id)
                return finish(
                    S.FAILED,
                    f"No se pudo recuperar el detalle de asistencia ({type(exc).__name__}).",
                )
        try:
            text, html = CollaboratorMailService.render(kind, event.snapshot)
            subject = CollaboratorMailService.subject(kind, event.snapshot)
        except Exception as exc:  # noqa: BLE001
            logger.exception("No se pudo construir el correo (%s %s)", kind, event_id)
            return finish(S.FAILED, f"No se pudo construir el correo ({type(exc).__name__}).")

        for email in targets:
            message = EmailMultiAlternatives(
                subject=subject, body=text, from_email=settings.DEFAULT_FROM_EMAIL, to=[email]
            )
            message.attach_alternative(html, "text/html")
            try:
                accepted = message.send(fail_silently=False)
                error = "" if accepted else "El servidor de correo no aceptó el mensaje."
            except Exception as exc:  # noqa: BLE001  (SMTP caído, credenciales, tiempo agotado…)
                accepted, error = False, CollaboratorMailService._safe_error(exc)
                logger.warning(
                    "Correo %s %s a un destinatario no enviado: %s", kind, event_id, error
                )
            entry = {
                "email": email,
                "status": "SENT" if accepted else "FAILED",
                "sent_at": timezone.now().isoformat() if accepted else None,
                "error": error[:200],
            }
            state = [r for r in state if r["email"] != email] + [entry]
            # Se guarda tras CADA destinatario: si el proceso se cae a mitad,
            # el reintento no repite a quienes ya lo recibieron.
            Model.objects.filter(pk=event.pk).update(recipients=state)

        failed = [r for r in state if r["email"] in targets and r["status"] != "SENT"]
        if not failed:
            return finish(S.SENT)
        sent = sum(1 for r in state if r["status"] == "SENT")
        return finish(
            S.FAILED,
            f"{len(failed)} de {len(failed) + sent} destinatario(s) sin enviar. "
            f"{failed[0]['email']}: {failed[0]['error']}"[:480],
        )

    # ── Consulta y reintentos ──────────────────────────────────────────────
    @staticmethod
    def events(acc: NovedadesAccess, limit: int = 50) -> list[dict]:
        _admin_only(acc)
        rows = []
        for kind in RecipientKind.values:
            handler = CollaboratorMailService.handler(kind)
            qs = handler.MODEL.objects.select_related(*handler.RELATED)[:limit]
            rows += [handler.serialize(e) for e in qs]
        rows.sort(key=lambda r: r["created_at"], reverse=True)
        return rows[:limit]

    @staticmethod
    def retry(acc: NovedadesAccess, kind: str, event_id, *, context=None) -> dict:
        """Reintento manual del Administrador sobre el MISMO evento."""
        _admin_only(acc)
        kind = NotificationRecipientService._kind(kind)
        handler = CollaboratorMailService.handler(kind)
        S = handler.MODEL.Status
        event = handler.MODEL.objects.filter(pk=event_id).first()
        if event is None:
            raise _not_found(f"Evento de {KIND_LABELS[kind]} no encontrado.")
        if event.status == S.SENT:
            raise NovedadesError(
                "Este correo ya fue enviado: no se reenvía.", code="already_sent", status=409
            )
        if event.status == S.SENDING:
            raise NovedadesError("El envío está en curso.", code="in_progress", status=409)
        if event.status not in (S.PENDING, S.FAILED):
            raise NovedadesError(
                "El colaborador todavía no alcanza su segundo día válido.", code="waiting"
            )
        record_audit_event(
            actor=acc.user,
            action=f"novedades.{KIND_LABELS[kind]}_notification.retry",
            module=MODULE,
            target_type=f"{KIND_LABELS[kind]}_notification",
            target_id=event.pk,
            context=context,
        )
        CollaboratorMailService.deliver(kind, event.pk)
        event = handler.MODEL.objects.select_related(*handler.RELATED).get(pk=event.pk)
        return handler.serialize(event)

    @staticmethod
    def retry_pending() -> dict:
        """Reintento programado de ambos tipos: Pendientes que no salieron
        (reinicio del proceso), Fallidos con intentos disponibles y Enviando
        atascados."""
        now = timezone.now()
        sent = failed = 0
        for kind in RecipientKind.values:
            Model = CollaboratorMailService.handler(kind).MODEL
            S = Model.Status
            # Un "Enviando" de hace más de 15 min es un proceso que murió a
            # mitad del envío. Lo ya entregado quedó registrado por
            # destinatario; solo se repite a quien quedó en curso en ese
            # instante (riesgo documentado).
            Model.objects.filter(
                status=S.SENDING, last_attempt_at__lt=now - CollaboratorMailService.STALE_SENDING
            ).update(
                status=S.FAILED, last_error="El envío anterior no terminó (proceso interrumpido)."
            )
            stale = now - CollaboratorMailService.STALE_PENDING
            pending = Q(status=S.PENDING) & (
                Q(triggered_at__lt=stale)
                if kind == RecipientKind.ENTRY
                else Q(created_at__lt=stale)
            )
            ids = list(
                Model.objects.filter(
                    pending
                    | Q(status=S.FAILED, attempts__lt=CollaboratorMailService.MAX_AUTO_ATTEMPTS)
                ).values_list("pk", flat=True)
            )
            for pk in ids:
                event = CollaboratorMailService.deliver(kind, pk)
                if event is not None and event.status == S.SENT:
                    sent += 1
                else:
                    failed += 1
        return {"sent": sent, "failed": failed}


def _recipient_summary(event) -> list[dict]:
    return CollaboratorMailService._state(event.recipients)


class ExitNotificationService:
    """Correo de salida (Activo → Inactivo). Un evento por transición (1 a 1
    con `CollaboratorStatusChange`); el envío lo hace `CollaboratorMailService`."""

    MODEL = CollaboratorExitNotification
    RELATED = ("collaborator", "supervisor", "changed_by", "period")
    NO_RECIPIENTS = CollaboratorMailService.NO_RECIPIENTS

    @staticmethod
    def is_suspension(s: dict) -> bool:
        # Las copias anteriores a la suspensión (2026-10-16) no guardan el código.
        return s.get("new_status_code") == Collaborator.Status.SUSPENDED or (
            "new_status_code" not in s and s.get("new_status") == "Suspendido"
        )

    @staticmethod
    def subject_title(s: dict) -> str:
        if ExitNotificationService.is_suspension(s):
            return "Notificación de suspensión de colaborador"
        return "Notificación de salida de colaborador"

    @staticmethod
    def build_snapshot_for(
        collaborator, supervisor, period, *, changed_by, changed_at, previous, new
    ) -> dict:
        labels = dict(Collaborator.Status.choices)
        return {
            **CollaboratorMailService.attendance(collaborator, supervisor, period),
            "changed_by": user_display(changed_by),
            "changed_at": changed_at.isoformat(),
            "changed_at_label": business_stamp(changed_at),
            "previous_status": labels[previous],
            "new_status": labels[new],
            "new_status_code": new,
        }

    @staticmethod
    def build_snapshot(event) -> dict:
        return ExitNotificationService.build_snapshot_for(
            event.collaborator,
            event.supervisor,
            event.period,
            changed_by=event.changed_by,
            changed_at=event.changed_at,
            previous=event.previous_status,
            new=event.new_status,
        )

    @staticmethod
    def content(s: dict) -> dict:
        system = settings.SYSTEM_NAME.upper()
        c = s["collaborator"]
        suspension = ExitNotificationService.is_suspension(s)
        return {
            "title": ExitNotificationService.subject_title(s),
            "header_line": (
                f"Cambio registrado el {s['changed_at_label']} · Período operativo "
                f"{s['period']['label']} ({s['period']['start_date']} al {s['period']['end_date']})"
            ),
            "message": (
                "Se informa que el colaborador indicado a continuación ha sido cambiado al estado "
                f"{s['new_status']} en {system} por el supervisor responsable. Para fines de "
                "seguimiento y trazabilidad operativa, se incluye el detalle de días laborados "
                "registrado en el período correspondiente."
            ),
            "info_rows": [
                ("Supervisor responsable", s["supervisor"]),
                ("Cargo", c["cargo"] or "—"),
                ("Cédula", c["cedula"]),
                ("Empleado", c["full_name"]),
                ("Estado anterior", s["previous_status"]),
                ("Nuevo estado", s["new_status"]),
                ("Fecha y hora del cambio", s["changed_at_label"]),
                ("Registrado por", s["changed_by"]),
                ("Período operativo", s["period"]["label"]),
            ],
            "footer": (
                f"Mensaje automático de {system}. Describe el cambio de estado registrado en el "
                "sistema; no indica su motivo ni constituye por sí mismo una sanción, la "
                "suspensión formal de la relación laboral ni trámites asociados."
                if suspension
                else f"Mensaje automático de {system}. Describe el cambio de estado registrado en "
                "el sistema; no constituye por sí mismo constancia de una terminación laboral ni "
                "de trámites asociados."
            ),
        }

    @staticmethod
    def register(status_change: CollaboratorStatusChange) -> CollaboratorExitNotification:
        collaborator = status_change.collaborator
        supervisor = collaborator.current_supervisor
        period = (
            CollaboratorService._event_period(supervisor)
            if supervisor is not None
            else PeriodService.get_period(period_for_date(today()))
        )
        event = CollaboratorExitNotification(
            status_change=status_change,
            collaborator=collaborator,
            supervisor=supervisor,
            changed_by=status_change.changed_by,
            changed_at=status_change.created_at,
            previous_status=status_change.previous_status,
            new_status=status_change.new_status,
            period=period,
        )
        try:
            with transaction.atomic():  # punto de guardado: un error aquí no
                # deshace el cambio de estado
                event.snapshot = ExitNotificationService.build_snapshot(event)
        except Exception as exc:  # noqa: BLE001
            logger.exception("No se pudo leer el detalle de asistencia del evento de salida")
            event.status = CollaboratorExitNotification.Status.FAILED
            event.last_error = (
                f"No se pudo recuperar el detalle de asistencia ({type(exc).__name__})."
            )
        event.save()
        transaction.on_commit(lambda: ExitNotificationService.schedule(event.pk))
        return event

    @staticmethod
    def schedule(event_id: int) -> None:
        CollaboratorMailService.schedule(RecipientKind.EXIT, event_id)

    @staticmethod
    def deliver(event_id: int):
        return CollaboratorMailService.deliver(RecipientKind.EXIT, event_id)

    @staticmethod
    def render(snapshot: dict) -> tuple[str, str]:
        return CollaboratorMailService.render(RecipientKind.EXIT, snapshot)

    @staticmethod
    def log(event: CollaboratorExitNotification) -> None:
        c = event.collaborator
        sent = event.status == CollaboratorExitNotification.Status.SENT
        delivered = sum(1 for r in _recipient_summary(event) if r["status"] == "SENT")
        what = "suspensión" if event.new_status == Collaborator.Status.SUSPENDED else "salida"
        EventService.log(
            actor=event.changed_by,
            action="exit_notification.sent" if sent else "exit_notification.failed",
            supervisor=event.supervisor,
            period=event.period,
            target_type="collaborator",
            target_id=c.pk,
            target_label=f"{c.full_name} ({c.cedula})",
            field="exit_notification",
            new_value=(
                f"Correo de {what} enviado a {delivered} destinatario(s)"
                if sent
                else f"Correo de {what} no enviado (intento {event.attempts}): {event.last_error}"
            ),
        )

    @staticmethod
    def serialize(event: CollaboratorExitNotification) -> dict:
        c = event.collaborator
        return {
            "id": event.pk,
            "kind": RecipientKind.EXIT,
            "collaborator": {"id": c.pk, "cedula": c.cedula, "full_name": c.full_name},
            "supervisor": user_display(event.supervisor),
            "changed_by": user_display(event.changed_by),
            "changed_at": event.changed_at,
            "created_at": event.created_at,
            "previous_status": event.previous_status,
            "new_status": event.new_status,
            "first_day": None,
            "second_day": None,
            "period": event.period.key.label,
            "status": event.status,
            "status_label": event.get_status_display(),
            "recipients": _recipient_summary(event),
            "attempts": event.attempts,
            "last_attempt_at": event.last_attempt_at,
            "last_error": event.last_error,
            "sent_at": event.sent_at,
        }

    @staticmethod
    def retry_pending() -> dict:
        return CollaboratorMailService.retry_pending()


class EntryNotificationService:
    """Correo de INGRESO de un colaborador nuevo (pedido del 2026-10-15).

    Reglas (decisiones del usuario):
    - Solo para altas marcadas como "nuevo ingreso" (casilla del formulario o,
      desde el 2026-10-16, columna NUEVO INGRESO con X en la importación de la
      base): esa marca es lo único que distingue un ingreso real de la carga
      de un equipo que ya trabajaba. Altas sin marca, reactivaciones y
      colaboradores existentes nunca generan este correo (no hay envíos
      retroactivos); una X en una fila de alguien que ya existe no cambia nada.
    - Día válido = fecha con horas > 0 en Días laborados (vacío y 0 no
      cuentan). Cada fecha cuenta una vez: editarla no suma días.
    - Se dispara al guardarse (ya confirmado en la base) el SEGUNDO día válido,
      por edición manual, importación o corrección; la tabla es la fila del
      período (23 → 22) de ese segundo día.
    - Un evento por alta (1 a 1 con el colaborador) y paso En espera →
      Pendiente con actualización condicional: nunca dos correos."""

    MODEL = CollaboratorEntryNotification
    RELATED = ("collaborator", "supervisor", "created_by", "period")

    @staticmethod
    def subject_title(s: dict) -> str:
        return "Notificación de ingreso de nuevo colaborador"

    @staticmethod
    def register(collaborator, actor) -> CollaboratorEntryNotification:
        """Al dar de alta a alguien marcado como nuevo ingreso (misma
        transacción que el alta)."""
        event = CollaboratorEntryNotification.objects.create(
            collaborator=collaborator, created_by=actor
        )
        EventService.log(
            actor=actor,
            action="entry_notification.registered",
            supervisor=collaborator.current_supervisor,
            period=CollaboratorService._event_period(collaborator.current_supervisor),
            target_type="collaborator",
            target_id=collaborator.pk,
            target_label=f"{collaborator.full_name} ({collaborator.cedula})",
            field="entry_notification",
            new_value="Nuevo ingreso: correo al registrar su segundo día válido en Días laborados",
        )
        return event

    @staticmethod
    def valid_days(collaborator_id) -> list[WorkedDay]:
        return list(
            WorkedDay.objects.filter(collaborator_id=collaborator_id, hours__gt=0)
            .select_related("period", "supervisor")
            .order_by("date")[:2]
        )

    @staticmethod
    def check(collaborator_ids) -> list[int]:
        """Después de guardar Días laborados (ya confirmado): dispara el correo
        de quienes, siendo nuevo ingreso, alcanzaron su segundo día válido."""
        S = CollaboratorEntryNotification.Status
        triggered = []
        waiting = CollaboratorEntryNotification.objects.filter(
            collaborator_id__in=set(collaborator_ids), status=S.WAITING
        ).values_list("pk", "collaborator_id")
        for event_id, collaborator_id in waiting:
            days = EntryNotificationService.valid_days(collaborator_id)
            if len(days) < 2:
                continue
            first, second = days
            claimed = CollaboratorEntryNotification.objects.filter(
                pk=event_id, status=S.WAITING
            ).update(
                status=S.PENDING,
                first_day=first.date,
                second_day=second.date,
                triggered_at=timezone.now(),
                supervisor=second.supervisor,
                period=second.period,
            )
            if not claimed:  # otro guardado simultáneo ya lo disparó
                continue
            event = CollaboratorEntryNotification.objects.select_related(
                *EntryNotificationService.RELATED
            ).get(pk=event_id)
            try:
                event.snapshot = EntryNotificationService.build_snapshot(event)
                event.save(update_fields=["snapshot"])
            except Exception:  # noqa: BLE001  (se reintenta al enviar)
                logger.exception("No se pudo leer el detalle del ingreso %s", event_id)
            c = event.collaborator
            EventService.log(
                actor=event.created_by,
                action="entry_notification.triggered",
                supervisor=event.supervisor,
                period=event.period,
                target_type="collaborator",
                target_id=c.pk,
                target_label=f"{c.full_name} ({c.cedula})",
                field="entry_notification",
                new_value=(
                    f"Segundo día válido registrado: {first.date:%d/%m/%Y} y "
                    f"{second.date:%d/%m/%Y} — período {event.period.key.label}"
                ),
            )
            triggered.append(event_id)
            EntryNotificationService.schedule(event_id)
        return triggered

    @staticmethod
    def build_snapshot(event) -> dict:
        c = event.collaborator
        return {
            **CollaboratorMailService.attendance(c, event.supervisor, event.period),
            "first_day": event.first_day.isoformat(),
            "second_day": event.second_day.isoformat(),
            "first_day_label": f"{event.first_day:%d/%m/%Y}",
            "second_day_label": f"{event.second_day:%d/%m/%Y}",
            "registered_by": user_display(event.created_by),
            "registered_at_label": business_stamp(c.created_at),
            "generated_at": (event.triggered_at or timezone.now()).isoformat(),
            "generated_at_label": business_stamp(event.triggered_at or timezone.now()),
        }

    @staticmethod
    def content(s: dict) -> dict:
        system = settings.SYSTEM_NAME.upper()
        c = s["collaborator"]
        return {
            "title": "Notificación de ingreso de nuevo colaborador",
            "header_line": (
                f"Generada el {s['generated_at_label']} · Período operativo "
                f"{s['period']['label']} ({s['period']['start_date']} al {s['period']['end_date']})"
            ),
            "message": (
                "Se notifica el ingreso operativo del colaborador indicado a continuación, "
                f"registrado en {system} como nuevo ingreso. La notificación se genera al "
                "registrarse su segundo día laborado en Días laborados; para fines de "
                "seguimiento se incluye el detalle del período correspondiente."
            ),
            "info_rows": [
                ("Empleado", c["full_name"]),
                ("Cédula", c["cedula"]),
                ("Cargo", c["cargo"] or "—"),
                ("Supervisor responsable", s["supervisor"]),
                ("Primer día laborado registrado", s["first_day_label"]),
                ("Segundo día laborado registrado", s["second_day_label"]),
                ("Período operativo", s["period"]["label"]),
                ("Alta en NEXO", f"{s['registered_at_label']} por {s['registered_by']}"),
                ("Notificación generada", s["generated_at_label"]),
            ],
            "footer": (
                f"Mensaje automático de {system}. Informa un ingreso operativo registrado en el "
                "sistema; no acredita la contratación, la afiliación al IESS ni otros procesos "
                "formales de Gestión Humana, que siguen su propio procedimiento."
            ),
        }

    @staticmethod
    def schedule(event_id: int) -> None:
        CollaboratorMailService.schedule(RecipientKind.ENTRY, event_id)

    @staticmethod
    def log(event: CollaboratorEntryNotification) -> None:
        c = event.collaborator
        sent = event.status == CollaboratorEntryNotification.Status.SENT
        delivered = sum(1 for r in _recipient_summary(event) if r["status"] == "SENT")
        EventService.log(
            actor=event.created_by,
            action="entry_notification.sent" if sent else "entry_notification.failed",
            supervisor=event.supervisor,
            period=event.period,
            target_type="collaborator",
            target_id=c.pk,
            target_label=f"{c.full_name} ({c.cedula})",
            field="entry_notification",
            new_value=(
                f"Correo de ingreso enviado a {delivered} destinatario(s)"
                if sent
                else f"Correo de ingreso no enviado (intento {event.attempts}): {event.last_error}"
            ),
        )

    @staticmethod
    def serialize(event: CollaboratorEntryNotification) -> dict:
        c = event.collaborator
        return {
            "id": event.pk,
            "kind": RecipientKind.ENTRY,
            "collaborator": {"id": c.pk, "cedula": c.cedula, "full_name": c.full_name},
            "supervisor": user_display(event.supervisor),
            "changed_by": user_display(event.created_by),
            "changed_at": event.triggered_at or event.created_at,
            "created_at": event.created_at,
            "previous_status": "",
            "new_status": "",
            "first_day": event.first_day,
            "second_day": event.second_day,
            "period": event.period.key.label if event.period else "",
            "status": event.status,
            "status_label": event.get_status_display(),
            "recipients": _recipient_summary(event),
            "attempts": event.attempts,
            "last_attempt_at": event.last_attempt_at,
            "last_error": event.last_error,
            "sent_at": event.sent_at,
        }


# ── Ingresos y Salidas: consulta consolidada con permisos por usuario ─────────
#
# Pedido del 2026-10-14. Solo lectura sobre los registros que ya existen —no
# hay una segunda fuente de movimientos—:
#   - Ingresos = altas en la base (`Collaborator`: fecha y usuario del alta) y
#     reingresos (`CollaboratorStatusChange` Inactivo → Activo).
#   - Salidas = cambios a Inactivo (`CollaboratorStatusChange`).
# NEXO no guarda una fecha formal de ingreso ni de salida laboral: se muestran
# las fechas de REGISTRO en el sistema, con esa etiqueta.
#
# Permisos: `novedades.ingresos_ver` y `novedades.salidas_ver`, del catálogo
# existente, asignados por usuario (`user.user_permissions`, el mecanismo
# granular de Django que ya usa NEXO) sin tocar el rol. El Administrador
# (`is_superuser`) los tiene siempre. Independientes del acceso al módulo.

MOVEMENT_ENTRIES = "entries"
MOVEMENT_EXITS = "exits"
MOVEMENT_CODENAMES = {
    MOVEMENT_ENTRIES: "novedades.ingresos_ver",
    MOVEMENT_EXITS: "novedades.salidas_ver",
}
MOVEMENT_LABELS = {MOVEMENT_ENTRIES: "Ingresos", MOVEMENT_EXITS: "Salidas"}
MOVEMENT_PAGE_SIZES = (25, 50, 100)
MOVEMENT_EXPORT_LIMIT = 10000


def _supervisor_at_event(collaborator_ref: str, moment_ref: str):
    """Supervisor responsable en el momento del movimiento: la asignación
    vigente a esa fecha (historial `CollaboratorAssignment`)."""
    return Subquery(
        CollaboratorAssignment.objects.filter(
            collaborator=OuterRef(collaborator_ref), started_at__lte=OuterRef(moment_ref)
        )
        .order_by("-started_at")
        .values("supervisor")[:1]
    )


class MovementService:
    @staticmethod
    def can_view(user, kind: str) -> bool:
        return user_has_permission(user, MOVEMENT_CODENAMES[kind])

    @staticmethod
    def access(user) -> dict:
        return {
            "entries": MovementService.can_view(user, MOVEMENT_ENTRIES),
            "exits": MovementService.can_view(user, MOVEMENT_EXITS),
            "can_manage": bool(user.is_superuser),
        }

    @staticmethod
    def _check(user, kind: str):
        if not MovementService.can_view(user, kind):
            raise _forbidden(f"No tiene acceso a la consulta de {MOVEMENT_LABELS[kind]}.")

    @staticmethod
    def _check_any(user):
        if not (
            MovementService.can_view(user, MOVEMENT_ENTRIES)
            or MovementService.can_view(user, MOVEMENT_EXITS)
        ):
            raise _forbidden("No tiene acceso a Ingresos ni a Salidas.")

    @staticmethod
    def options(user) -> dict:
        """Valores de los filtros (supervisores y cargos existentes)."""
        MovementService._check_any(user)
        supervisor_ids = set(
            CollaboratorAssignment.objects.values_list("supervisor", flat=True).distinct()
        )
        supervisors = sorted(
            (
                {"id": u.pk, "name": user_display(u)}
                for u in User.objects.filter(pk__in=supervisor_ids)
            ),
            key=lambda x: x["name"].lower(),
        )
        # El mismo cargo aparece escrito de varias formas ("COURIER", "Courier"):
        # una sola opción por cargo sin distinguir mayúsculas (el filtro también
        # las ignora).
        cargos: dict[str, str] = {}
        for cargo in Collaborator.objects.values_list("cargo", flat=True).distinct():
            cargo = " ".join((cargo or "").split())
            if cargo:
                cargos.setdefault(cargo.casefold(), cargo)
        cargos = sorted(cargos.values(), key=str.casefold)
        statuses = [{"value": v, "label": l_} for v, l_ in Collaborator.Status.choices]
        return {"supervisors": supervisors, "cargos": cargos, "statuses": statuses}

    @staticmethod
    def _filters(params) -> dict:
        get = params.get
        f = {
            "q": " ".join(str(get("q") or "").split()),
            "date_from": (
                _parse_date_param(get("date_from"), "date_from") if get("date_from") else None
            ),
            "date_to": _parse_date_param(get("date_to"), "date_to") if get("date_to") else None,
            "cargo": str(get("cargo") or "").strip(),
            "supervisor": (
                _parse_id_param(get("supervisor"), "supervisor") if get("supervisor") else None
            ),
            "status": str(get("status") or "").strip(),
            "order": "asc" if get("order") == "asc" else "desc",
        }
        if f["status"] and f["status"] not in Collaborator.Status.values:
            raise NovedadesError("Estado inválido.", details={"status": ["Valor inválido."]})
        if f["date_from"] and f["date_to"] and f["date_from"] > f["date_to"]:
            raise NovedadesError("La fecha inicial es posterior a la final.")
        return f

    @staticmethod
    def _apply(qs, f: dict, *, prefix: str, date_field: str):
        """Mismos filtros para altas (prefix="") y cambios de estado
        (prefix="collaborator__"). El supervisor filtra por el responsable EN
        EL MOMENTO del movimiento (anotación `event_supervisor`)."""
        if f["q"]:
            qs = qs.filter(
                Q(**{f"{prefix}cedula__icontains": f["q"]})
                | Q(**{f"{prefix}full_name__icontains": f["q"]})
            )
        if f["date_from"] or f["date_to"]:
            start, end = business_range(
                f["date_from"] or date(2000, 1, 1), f["date_to"] or date(2100, 1, 1)
            )
            qs = qs.filter(**{f"{date_field}__gte": start, f"{date_field}__lt": end})
        if f["cargo"]:
            qs = qs.filter(**{f"{prefix}cargo__iexact": f["cargo"]})
        if f["status"]:
            qs = qs.filter(**{f"{prefix}status": f["status"]})
        if f["supervisor"]:
            qs = qs.filter(event_supervisor=f["supervisor"])
        return qs

    @staticmethod
    def _entry_querysets(f: dict):
        first_assignment = Subquery(
            CollaboratorAssignment.objects.filter(collaborator=OuterRef("pk"))
            .order_by("started_at")
            .values("supervisor")[:1]
        )
        altas = Collaborator.objects.annotate(
            event_supervisor=Coalesce(
                first_assignment, F("current_supervisor"), output_field=BigIntegerField()
            )
        )
        returns = CollaboratorStatusChange.objects.filter(
            previous_status=Collaborator.Status.INACTIVE, new_status=Collaborator.Status.ACTIVE
        ).annotate(
            event_supervisor=Coalesce(
                _supervisor_at_event("collaborator", "created_at"),
                F("collaborator__current_supervisor"),
                output_field=BigIntegerField(),
            )
        )
        return (
            MovementService._apply(altas, f, prefix="", date_field="created_at"),
            MovementService._apply(returns, f, prefix="collaborator__", date_field="created_at"),
        )

    @staticmethod
    def _exit_queryset(f: dict):
        qs = CollaboratorStatusChange.objects.filter(
            new_status=Collaborator.Status.INACTIVE
        ).annotate(
            event_supervisor=Coalesce(
                _supervisor_at_event("collaborator", "created_at"),
                F("collaborator__current_supervisor"),
                output_field=BigIntegerField(),
            )
        )
        return MovementService._apply(qs, f, prefix="collaborator__", date_field="created_at")

    @staticmethod
    def _page_params(params) -> tuple[int, int]:
        try:
            page = max(1, int(params.get("page") or 1))
        except ValueError:
            page = 1
        try:
            size = int(params.get("page_size") or 25)
        except ValueError:
            size = 25
        return page, size if size in MOVEMENT_PAGE_SIZES else 25

    @staticmethod
    def _names(user_ids) -> dict[int, str]:
        return {u.pk: user_display(u) for u in User.objects.filter(pk__in=set(user_ids) - {None})}

    # ── Ingresos ──────────────────────────────────────────────────────────
    @staticmethod
    def _entry_keys(f: dict) -> list[tuple]:
        """Claves (fecha, tipo, id, colaborador) ordenadas de forma estable:
        altas y reingresos son dos tablas, se combinan solo sus claves y el
        detalle se lee únicamente para la página pedida."""
        altas, returns = MovementService._entry_querysets(f)
        keys = [(d, "ALTA", pk, pk) for pk, d in altas.values_list("pk", "created_at")]
        keys += [
            (d, "REINGRESO", pk, cid)
            for pk, d, cid in returns.values_list("pk", "created_at", "collaborator_id")
        ]
        keys.sort(key=lambda k: (k[0], k[1], k[2]), reverse=f["order"] == "desc")
        return keys

    @staticmethod
    def _entry_rows(keys: list[tuple]) -> list[dict]:
        alta_ids = [k[2] for k in keys if k[1] == "ALTA"]
        return_ids = [k[2] for k in keys if k[1] == "REINGRESO"]
        first_assignment = Subquery(
            CollaboratorAssignment.objects.filter(collaborator=OuterRef("pk"))
            .order_by("started_at")
            .values("supervisor")[:1]
        )
        altas = {
            c.pk: c
            for c in Collaborator.objects.filter(pk__in=alta_ids).annotate(
                event_supervisor=Coalesce(
                    first_assignment, F("current_supervisor"), output_field=BigIntegerField()
                )
            )
        }
        returns = {
            sc.pk: sc
            for sc in CollaboratorStatusChange.objects.filter(pk__in=return_ids)
            .select_related("collaborator")
            .annotate(
                event_supervisor=Coalesce(
                    _supervisor_at_event("collaborator", "created_at"),
                    F("collaborator__current_supervisor"),
                    output_field=BigIntegerField(),
                )
            )
        }
        # Origen del alta (formulario o archivo importado), del evento ya registrado.
        origins = dict(
            NovedadEvent.objects.filter(
                action="collaborator.created", target_id__in=[str(i) for i in alta_ids]
            ).values_list("target_id", "source_file")
        )
        names = MovementService._names(
            [c.event_supervisor for c in altas.values()]
            + [c.created_by_id for c in altas.values()]
            + [sc.event_supervisor for sc in returns.values()]
            + [sc.changed_by_id for sc in returns.values()]
        )
        statuses = dict(Collaborator.Status.choices)
        rows = []
        for _, kind, pk, _cid in keys:
            if kind == "ALTA":
                c = altas[pk]
                source = origins.get(str(pk))
                rows.append(
                    {
                        "id": f"A{pk}",
                        "kind": kind,
                        "kind_label": "Alta en NEXO",
                        "registered_at": c.created_at,
                        "collaborator_id": c.pk,
                        "cedula": c.cedula,
                        "full_name": c.full_name,
                        "cargo": c.cargo,
                        "area": c.area,
                        "regional": c.regional,
                        "supervisor": names.get(c.event_supervisor, ""),
                        "status": c.status,
                        "status_label": statuses[c.status],
                        "registered_by": names.get(c.created_by_id, ""),
                        "origin": f"Importación ({source})" if source else "Formulario",
                    }
                )
            else:
                sc = returns[pk]
                c = sc.collaborator
                rows.append(
                    {
                        "id": f"R{pk}",
                        "kind": kind,
                        "kind_label": "Reingreso (Inactivo → Activo)",
                        "registered_at": sc.created_at,
                        "collaborator_id": c.pk,
                        "cedula": c.cedula,
                        "full_name": c.full_name,
                        "cargo": c.cargo,
                        "area": c.area,
                        "regional": c.regional,
                        "supervisor": names.get(sc.event_supervisor, ""),
                        "status": c.status,
                        "status_label": statuses[c.status],
                        "registered_by": names.get(sc.changed_by_id, ""),
                        "origin": "Cambio de estado",
                    }
                )
        return rows

    @staticmethod
    def entries(user, params) -> dict:
        MovementService._check(user, MOVEMENT_ENTRIES)
        f = MovementService._filters(params)
        page, size = MovementService._page_params(params)
        keys = MovementService._entry_keys(f)
        chunk = keys[(page - 1) * size : page * size]
        return {
            "results": MovementService._entry_rows(chunk),
            "count": len(keys),
            "page": page,
            "page_size": size,
            "counters": {
                "movements": len(keys),
                "people": len({k[3] for k in keys}),
                "altas": sum(1 for k in keys if k[1] == "ALTA"),
                "reingresos": sum(1 for k in keys if k[1] == "REINGRESO"),
            },
        }

    # ── Salidas ───────────────────────────────────────────────────────────
    @staticmethod
    def _exit_rows(changes) -> list[dict]:
        changes = list(changes)
        names = MovementService._names(
            [sc.event_supervisor for sc in changes] + [sc.changed_by_id for sc in changes]
        )
        statuses = dict(Collaborator.Status.choices)
        return [
            {
                "id": sc.pk,
                "changed_at": sc.created_at,
                "previous_status": sc.previous_status,
                "previous_status_label": statuses[sc.previous_status],
                "collaborator_id": sc.collaborator_id,
                "cedula": sc.collaborator.cedula,
                "full_name": sc.collaborator.full_name,
                "cargo": sc.collaborator.cargo,
                "area": sc.collaborator.area,
                "regional": sc.collaborator.regional,
                "supervisor": names.get(sc.event_supervisor, ""),
                "status": sc.collaborator.status,
                "status_label": statuses[sc.collaborator.status],
                "changed_by": names.get(sc.changed_by_id, ""),
            }
            for sc in changes
        ]

    @staticmethod
    def _ordered_exits(f: dict):
        order = ("created_at", "pk") if f["order"] == "asc" else ("-created_at", "-pk")
        return MovementService._exit_queryset(f).select_related("collaborator").order_by(*order)

    @staticmethod
    def exits(user, params) -> dict:
        MovementService._check(user, MOVEMENT_EXITS)
        f = MovementService._filters(params)
        page, size = MovementService._page_params(params)
        qs = MovementService._ordered_exits(f)
        total = qs.count()
        return {
            "results": MovementService._exit_rows(qs[(page - 1) * size : page * size]),
            "count": total,
            "page": page,
            "page_size": size,
            "counters": {
                "movements": total,
                "people": qs.order_by().values("collaborator").distinct().count(),
            },
        }

    # ── Exportación (mismos filtros y permisos) ───────────────────────────
    @staticmethod
    def export_rows(user, kind: str, params, *, context=None) -> tuple[list[dict], dict]:
        MovementService._check(user, kind)
        f = MovementService._filters(params)
        if kind == MOVEMENT_ENTRIES:
            keys = MovementService._entry_keys(f)
            if len(keys) > MOVEMENT_EXPORT_LIMIT:
                raise NovedadesError(
                    f"La consulta tiene {len(keys)} registros: acote los filtros (máximo "
                    f"{MOVEMENT_EXPORT_LIMIT} por archivo)."
                )
            rows = MovementService._entry_rows(keys)
        else:
            qs = MovementService._ordered_exits(f)
            total = qs.count()
            if total > MOVEMENT_EXPORT_LIMIT:
                raise NovedadesError(
                    f"La consulta tiene {total} registros: acote los filtros (máximo "
                    f"{MOVEMENT_EXPORT_LIMIT} por archivo)."
                )
            rows = MovementService._exit_rows(qs)
        record_audit_event(
            actor=user,
            action=f"novedades.movements.export_{kind}",
            module=MODULE,
            target_type="movements",
            new_values={
                "rows": len(rows),
                "filters": {k: str(v) for k, v in f.items() if v},
            },
            context=context,
        )
        return rows, f


class MovementPermissionService:
    """Ajustes → Permisos de visibilidad — Ingresos y Salidas. Solo el
    Administrador; cada pestaña es un permiso individual e independiente."""

    @staticmethod
    def _check(actor):
        if not actor.is_superuser:
            raise _forbidden("Solo el Administrador puede gestionar estos permisos.")

    @staticmethod
    def _permissions():
        from django.contrib.auth.models import Permission

        perms = {
            p.codename: p
            for p in Permission.objects.filter(codename__in=MOVEMENT_CODENAMES.values())
        }
        missing = set(MOVEMENT_CODENAMES.values()) - set(perms)
        if missing:  # migraciones sin aplicar
            raise NovedadesError("Permisos de Ingresos/Salidas no instalados.", status=500)
        return perms

    @staticmethod
    def _serialize(u, perms) -> dict:
        from django.contrib.auth.models import Permission

        direct = set(
            u.user_permissions.filter(pk__in=[p.pk for p in perms.values()]).values_list(
                "codename", flat=True
            )
        )
        # Concedidos por el ROL (grupo): se muestran aparte; esta pantalla solo
        # gestiona los individuales.
        by_role = set(
            Permission.objects.filter(
                pk__in=[p.pk for p in perms.values()], group__user=u
            ).values_list("codename", flat=True)
        )
        groups = list(u.groups.values_list("name", flat=True))
        result = {
            "id": u.pk,
            "name": user_display(u),
            "username": u.username,
            "email": u.email,
            "role": groups[0] if groups else "",
            "is_active": u.is_active,
        }
        for kind, codename in MOVEMENT_CODENAMES.items():
            result[kind] = {"direct": codename in direct, "by_role": codename in by_role}
        return result

    @staticmethod
    def users(actor, q: str = "") -> list[dict]:
        MovementPermissionService._check(actor)
        perms = MovementPermissionService._permissions()
        users = User.objects.filter(is_superuser=False).order_by(
            "first_name", "last_name", "username"
        )
        q = " ".join(str(q or "").split())
        if q:
            users = users.filter(
                Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(username__icontains=q)
                | Q(email__icontains=q)
            )
        return [MovementPermissionService._serialize(u, perms) for u in users]

    @staticmethod
    def update(actor, user_id, data: dict, *, context=None) -> dict:
        MovementPermissionService._check(actor)
        perms = MovementPermissionService._permissions()
        target = User.objects.filter(pk=user_id).first()
        if target is None:
            raise _not_found("Usuario no encontrado.")
        if target.pk == actor.pk:
            raise _forbidden("No puede modificar sus propios permisos.")
        if target.is_superuser:
            raise NovedadesError(
                "El Administrador ya tiene acceso a ambas pestañas por su rol.", code="admin"
            )
        changes = {k: data[k] for k in MOVEMENT_CODENAMES if k in data}
        if not changes:
            raise NovedadesError("Indique al menos una pestaña.")
        if any(not isinstance(v, bool) for v in changes.values()):
            raise NovedadesError("Valor inválido: use verdadero o falso.")
        with transaction.atomic():
            for kind, enabled in changes.items():
                perm = perms[MOVEMENT_CODENAMES[kind]]
                before = target.user_permissions.filter(pk=perm.pk).exists()
                if before == enabled:
                    continue
                if enabled:
                    target.user_permissions.add(perm)
                else:
                    target.user_permissions.remove(perm)
                record_audit_event(
                    actor=actor,
                    action="novedades.movements.permission_changed",
                    target=target,
                    module=MODULE,
                    previous_values={"tab": MOVEMENT_LABELS[kind], "enabled": before},
                    new_values={"tab": MOVEMENT_LABELS[kind], "enabled": enabled},
                    context=context,
                )
        return MovementPermissionService._serialize(User.objects.get(pk=target.pk), perms)
