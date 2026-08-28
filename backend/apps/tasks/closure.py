"""Helpers puros del Motor de Cierre Inteligente — portados 1:1 de
`src/app/api/tasks/close-month/route.ts` (Fase 3d, ver docs/AUDIT_LOG.md §
2026-08-07). Las fechas de `Task` se tratan siempre como medianoche UTC;
toda esta aritmética usa UTC explícito, nunca huso local. Puro: sin
dependencias de Django salvo el error de validación DRF."""

import calendar
import re
from datetime import datetime, timezone

from rest_framework import serializers as drf_serializers

from .business_time import business_calendar_day

RECURRING_FREQUENCIES = frozenset({"MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL"})

_CUTOFF_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def period_start(year: int, month: int) -> datetime:
    return datetime(year, month, 1, tzinfo=timezone.utc)


def next_year_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def next_month_start(year: int, month: int) -> datetime:
    next_year, next_month = next_year_month(year, month)
    return datetime(next_year, next_month, 1, tzinfo=timezone.utc)


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def natural_cutoff(year: int, month: int) -> datetime:
    """Último día calendario del mes, medianoche UTC — default de la Fecha
    de Corte cuando no se especifica una."""
    return datetime(year, month, days_in_month(year, month), tzinfo=timezone.utc)


def shift_to_next_month(value: datetime, next_year: int, next_month: int) -> datetime:
    """Mismo día del mes en el mes siguiente, con clamp al último día
    válido si no existe (ej. 31 ene -> 28/29 feb) — preserva hora/min/seg
    vía `datetime.replace`."""
    last_day = days_in_month(next_year, next_month)
    return value.replace(year=next_year, month=next_month, day=min(value.day, last_day))


def previous_month(now: datetime) -> tuple[int, int]:
    """Mes calendario anterior al actual, en el huso de negocio ya
    establecido en `business_time.py` — default cuando no se especifica
    año/mes."""
    today = business_calendar_day(now)
    if today.month == 1:
        return today.year - 1, 12
    return today.year, today.month - 1


def resolve_cutoff_date(year: int, month: int, raw: str | None, now: datetime) -> datetime:
    """Levanta `ValidationError` con el mensaje exacto del legacy en cada
    caso inválido."""
    period = period_start(year, month)
    natural = natural_cutoff(year, month)
    if not raw:
        return natural

    match = _CUTOFF_DATE_RE.match(raw)
    if not match:
        raise drf_serializers.ValidationError({"non_field_errors": ["Fecha de corte inválida"]})
    try:
        cutoff = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)), tzinfo=timezone.utc)
    except ValueError:
        raise drf_serializers.ValidationError({"non_field_errors": ["Fecha de corte inválida"]})

    if cutoff < period or cutoff > natural:
        raise drf_serializers.ValidationError(
            {"non_field_errors": ["La fecha de corte debe estar dentro del período seleccionado"]}
        )

    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    if cutoff > today:
        raise drf_serializers.ValidationError(
            {"non_field_errors": ["La fecha de corte no puede ser posterior a hoy"]}
        )

    return cutoff


def determine_closure_type(year: int, month: int, cutoff_date: datetime, now: datetime) -> str:
    """NORMAL: el corte coincide con el último día del período. EARLY: el
    cierre se ejecuta antes de que el período termine. MANUAL: el período
    ya terminó pero igual se eligió un corte anterior (regularización)."""
    if cutoff_date == natural_cutoff(year, month):
        return "NORMAL"
    return "EARLY" if now < next_month_start(year, month) else "MANUAL"
