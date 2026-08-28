"""Helpers puros del importador de Tareas por Excel — portados 1:1 de
`src/app/api/tasks/import/route.ts` (Fase 3e, ver docs/AUDIT_LOG.md §
2026-08-07). Las fechas de `Task` se tratan siempre como medianoche UTC —
ver mismo criterio en `closure.py`. Puro: sin dependencias de Django."""

import re
from datetime import date, datetime, timedelta

from apps.core.rounding import round_half_up

VALID_PRIORITIES = {"ALTA", "MEDIA", "BAJA"}
VALID_FREQUENCIES = {"MENSUAL", "SEMANAL", "DIARIA", "QUINCENAL", "PUNTUAL"}
VALID_TYPES = {"FIJA", "SEGUIMIENTO"}

_ISO_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_SLASH_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")

# Los números de serie de fecha de Excel cuentan días desde este día.
_EXCEL_EPOCH = date(1899, 12, 30)


def _is_valid_date(year: int, month: int, day: int) -> bool:
    if month < 1 or month > 12 or day < 1 or day > 31:
        return False
    try:
        date(year, month, day)
    except ValueError:
        return False
    return True


def _excel_serial_to_date(serial: float) -> date | None:
    try:
        return _EXCEL_EPOCH + timedelta(days=round_half_up(serial))
    except (OverflowError, ValueError):
        return None


def parse_date(value) -> date | None:
    """Réplica de `parseDate` legacy. `openpyxl` ya entrega objetos
    `datetime`/`date` nativos para celdas con formato de fecha real (a
    diferencia de SheetJS, que entrega un serial numérico) — se manejan
    ambos casos, mismo resultado final."""
    if value is None or value == "":
        return None

    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        return _excel_serial_to_date(value)

    text = str(value).strip()
    if not text:
        return None

    match = _ISO_RE.match(text)
    if match:
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        return date(year, month, day) if _is_valid_date(year, month, day) else None

    match = _SLASH_RE.match(text)
    if match:
        a, b, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if _is_valid_date(year, b, a):
            return date(year, b, a)
        if _is_valid_date(year, a, b):
            return date(year, a, b)
        return None

    return None
