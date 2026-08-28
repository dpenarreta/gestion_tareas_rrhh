"""Helpers de tiempo de negocio — portados 1:1 de `src/lib/businessTime.ts`
y `src/lib/timeOverlap.ts` del Next.js legacy (Fase 3b, ver
docs/AUDIT_LOG.md § 2026-08-07). Puros: sin dependencias de Django."""

import re
from datetime import date, datetime, timedelta, timezone

BUSINESS_TZ_OFFSET_HOURS = 5

_TIME_RE = re.compile(r"^(\d{2}):(\d{2})$")


def business_calendar_day(instant: datetime) -> date:
    """El día calendario de negocio (huso desplazado `BUSINESS_TZ_OFFSET_HOURS`
    respecto a UTC) al que pertenece `instant`."""
    shifted = instant - timedelta(hours=BUSINESS_TZ_OFFSET_HOURS)
    return shifted.date()


def business_day_real_range(cal_day: date) -> tuple[datetime, datetime]:
    """El rango real de instantes UTC que abarca el día de negocio
    `cal_day` — para comparar contra timestamps reales
    (`TaskActivity.created_at`), no contra fechas sueltas."""
    start = datetime(
        cal_day.year, cal_day.month, cal_day.day, BUSINESS_TZ_OFFSET_HOURS, tzinfo=timezone.utc
    )
    end = start + timedelta(days=1) - timedelta(milliseconds=1)
    return start, end


def is_business_day(cal_day: date) -> bool:
    """Lunes a viernes."""
    return cal_day.weekday() < 5


def previous_business_days(today: date, count: int) -> list[date]:
    """Los `count` días laborables (lun-vie) más recientes, estrictamente
    anteriores a `today`, en orden descendente (el más reciente primero)
    — acota la ventana de registro retroactivo de horas."""
    days: list[date] = []
    cursor = today
    while len(days) < count:
        cursor = cursor - timedelta(days=1)
        if is_business_day(cursor):
            days.append(cursor)
    return days


def weekend_grace_days(today: date) -> list[date]:
    """El sábado y domingo del fin de semana inmediatamente anterior a
    `today`, solo cuando `today` es lunes (weekday=0) o martes
    (weekday=1) — a partir del miércoles esos días ya no son
    registrables. Devuelve más reciente primero (domingo, luego
    sábado)."""
    dow = today.weekday()
    if dow not in (0, 1):
        return []
    monday = today - timedelta(days=dow)
    sunday = monday - timedelta(days=1)
    saturday = monday - timedelta(days=2)
    return [sunday, saturday]


def retroactive_valid_dates(today: date, business_day_count: int) -> list[date]:
    """Motor único de validación para registro retroactivo: los
    `business_day_count` días laborables más recientes más, si aplica, el
    fin de semana inmediato anterior."""
    return sorted(
        [*previous_business_days(today, business_day_count), *weekend_grace_days(today)], reverse=True
    )


_DATE_ONLY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def parse_date_only(value: str) -> date | None:
    """`"YYYY-MM-DD"` (de un `<input type="date">`) -> `date`, o `None` si
    el formato no es válido — a diferencia de `task_import.parse_date`
    (que también acepta seriales de Excel/formatos ambiguos), el registro
    retroactivo legacy usa exclusivamente este formato estricto."""
    match = _DATE_ONLY_RE.match(value)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def time_to_minutes(value: str) -> int | None:
    """`"HH:MM"` -> minutos desde medianoche, o `None` si el formato no es
    válido."""
    match = _TIME_RE.match(value)
    if not match:
        return None
    hours, minutes = int(match.group(1)), int(match.group(2))
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


def ranges_overlap(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    """`True` si `[a_start,a_end)` se solapa con `[b_start,b_end)` — cubre
    solapamiento parcial, contención total en cualquier dirección y
    coincidencia exacta."""
    s1, e1, s2, e2 = (
        time_to_minutes(a_start),
        time_to_minutes(a_end),
        time_to_minutes(b_start),
        time_to_minutes(b_end),
    )
    if None in (s1, e1, s2, e2):
        return False
    return s1 < e2 and s2 < e1
