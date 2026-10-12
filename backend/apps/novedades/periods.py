"""Calendario operativo del módulo Control Operativo de Novedades.

Regla de negocio (pedido explícito, ver docs/DECISIONS.md): todo período
mensual va del día 23 de un mes al día 22 del mes siguiente, ambos
inclusive, y se identifica por el mes en el que TERMINA — octubre 2026 =
23/09/2026 a 22/10/2026. Es el ÚNICO lugar donde se calcula ese corte:
ninguna vista, servicio ni importador recalcula fechas por su cuenta.

Trabaja solo con `date` (sin hora ni zona): las celdas del módulo son días
calendario, así que no hay conversión UTC que pueda correr una fecha.
"""

from dataclasses import dataclass
from datetime import date, timedelta

CUTOFF_DAY = 22
START_DAY = CUTOFF_DAY + 1

MONTH_NAMES_ES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
]

WEEKDAY_NAMES_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


@dataclass(frozen=True)
class PeriodKey:
    """Identificador de un período: año y mes de CIERRE."""

    year: int
    month: int

    def __post_init__(self):
        if not 1 <= self.month <= 12:
            raise ValueError(f"Mes inválido: {self.month}")

    @property
    def code(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"

    @property
    def label(self) -> str:
        return f"{MONTH_NAMES_ES[self.month - 1]} {self.year}"

    @property
    def start_date(self) -> date:
        prev = self.previous()
        return date(prev.year, prev.month, START_DAY)

    @property
    def end_date(self) -> date:
        return date(self.year, self.month, CUTOFF_DAY)

    def previous(self) -> "PeriodKey":
        if self.month == 1:
            return PeriodKey(self.year - 1, 12)
        return PeriodKey(self.year, self.month - 1)

    def next(self) -> "PeriodKey":
        if self.month == 12:
            return PeriodKey(self.year + 1, 1)
        return PeriodKey(self.year, self.month + 1)

    def contains(self, day: date) -> bool:
        return self.start_date <= day <= self.end_date

    def dates(self) -> list[date]:
        start, end = self.start_date, self.end_date
        return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def period_for_date(day: date) -> PeriodKey:
    """Período al que pertenece un día: del 23 en adelante ya cuenta para el
    mes siguiente (incluido el cambio de año en diciembre)."""
    if day.day >= START_DAY:
        return PeriodKey(day.year, day.month).next()
    return PeriodKey(day.year, day.month)


def parse_period_code(code: str) -> PeriodKey:
    """`"2026-10"` -> PeriodKey(2026, 10). Lanza ValueError si no es válido."""
    try:
        year_str, month_str = code.strip().split("-")
        return PeriodKey(int(year_str), int(month_str))
    except (AttributeError, ValueError) as exc:
        raise ValueError(f"Período inválido: {code!r} (formato esperado AAAA-MM)") from exc


def is_weekend(day: date) -> bool:
    """Sábado o domingo — columnas bloqueadas en Días laborados."""
    return day.weekday() >= 5
