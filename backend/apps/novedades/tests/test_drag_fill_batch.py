"""Lote de Días laborados como el que envía el arrastre tipo Excel (v1.181.0):
una misma fecha para muchas filas, en UNA llamada. El servidor valida cada
celda por separado (nunca solo la de origen) y no guarda nada si alguna no
procede; un lote válido queda con su historial celda por celda."""

from datetime import date
from decimal import Decimal

import pytest

from apps.novedades.models import Collaborator, NovedadEvent, WorkedDay
from apps.novedades.periods import PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    NovedadesError,
    PeriodService,
    WorkedDayService,
)

from .conftest import access

pytestmark = pytest.mark.django_db
OCT = PeriodKey(2026, 10)
FRI = date(2026, 10, 9)  # dentro del plazo para el Supervisor (hoy lunes 12/10)


def _team(sup, n, prefix="01020304"):
    PeriodService.ensure_current(sup)
    return [
        CollaboratorService.create(
            access(sup), CollaboratorInput(cedula=f"{prefix}{i:02d}", full_name=f"Persona {i:02d}")
        )
        for i in range(n)
    ]


def _cells(collaborators, hours="8"):
    return [{"collaborator_id": c.pk, "date": FRI, "hours": hours} for c in collaborators]


def test_valid_fill_is_saved_in_one_call_with_per_cell_history(supervisor):
    team = _team(supervisor, 12)
    result = WorkedDayService.save_cells(access(supervisor), OCT, supervisor, _cells(team))
    assert result == {"saved": 12}
    assert set(WorkedDay.objects.filter(date=FRI).values_list("hours", flat=True)) == {Decimal("8")}
    events = NovedadEvent.objects.filter(action="worked_day.created", field=FRI.isoformat())
    assert events.count() == 12 and {e.new_value for e in events} == {"8"}


def test_every_cell_of_the_range_is_validated(supervisor, supervisor2):
    team = _team(supervisor, 4)
    Collaborator.objects.filter(pk=team[1].pk).update(status="INACTIVE")  # sin valor previo
    other = _team(supervisor2, 1, prefix="09080706")[0]  # fuera de su equipo
    cells = _cells(team) + _cells([other])
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(access(supervisor), OCT, supervisor, cells)
    rejected = {c["collaborator_id"] for c in exc.value.details["cells"]}
    assert rejected == {team[1].pk, other.pk}  # cada celda inválida, identificada
    assert not WorkedDay.objects.exists()  # nada a medias


def test_overwrite_existing_values_in_range(supervisor):
    team = _team(supervisor, 3)
    WorkedDayService.save_cells(access(supervisor), OCT, supervisor, _cells(team, "6"))
    cells = [{"collaborator_id": c.pk, "date": FRI, "hours": "8", "version": 1} for c in team]
    assert WorkedDayService.save_cells(access(supervisor), OCT, supervisor, cells) == {"saved": 3}
    assert set(WorkedDay.objects.values_list("hours", flat=True)) == {Decimal("8")}
    updated = NovedadEvent.objects.filter(action="worked_day.updated")
    assert {(e.old_value, e.new_value) for e in updated} == {("6", "8")}
