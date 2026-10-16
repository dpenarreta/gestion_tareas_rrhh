"""Vista "Todos los supervisores" para el alcance nacional (Asistente de
Operaciones y Administrador): Días laborados sin elegir un supervisor, filtro
opcional por equipo y contadores de cierre sobre los supervisores autorizados."""

from datetime import date

import pytest

from apps.novedades.models import WorkedDay
from apps.novedades.periods import PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    PeriodService,
    WorkedDayService,
)

from .conftest import access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
OCT = PeriodKey(2026, 10)
FRI = date(2026, 10, 9)


def _collab(sup, cedula, name):
    return CollaboratorService.create(
        access(sup), CollaboratorInput(cedula=cedula, full_name=name, regional="Sierra")
    )


def test_assistant_sees_all_authorized_teams_without_choosing(
    client_for, assistant, supervisor, supervisor2
):
    a = _collab(supervisor, "0102030405", "Ana")
    b = _collab(supervisor2, "0102030406", "Beto")
    WorkedDayService.save_cells(
        access(supervisor), OCT, supervisor, [{"collaborator_id": a.pk, "date": FRI, "hours": "8"}]
    )
    body = client_for(assistant).get(f"{BASE}/worked-days/", {"period": "2026-10"}).json()
    assert body["supervisor"] is None
    by_id = {r["collaborator_id"]: r for r in body["rows"]}
    assert set(by_id) == {a.pk, b.pk}  # los dos equipos, sin duplicados
    assert (
        by_id[a.pk]["supervisor_id"] == supervisor.pk and by_id[a.pk]["supervisor_name"] == "Sup1"
    )
    assert by_id[b.pk]["supervisor_id"] == supervisor2.pk
    assert by_id[a.pk]["cells"][FRI.isoformat()]["hours"] == "8"
    assert by_id[a.pk]["editable"] is True  # el Asistente corrige fechas pasadas
    assert body["supervisors_total"] == 2 and body["supervisors_closed"] == 0
    assert body["closable"] is False  # cerrar sigue siendo por equipo
    # Filtro opcional por supervisor: solo su equipo.
    one = (
        client_for(assistant)
        .get(f"{BASE}/worked-days/", {"period": "2026-10", "supervisor": supervisor2.pk})
        .json()
    )
    assert one["supervisor"]["id"] == supervisor2.pk
    assert [r["collaborator_id"] for r in one["rows"]] == [b.pk]


def test_close_counters_follow_individual_closes(client_for, assistant, supervisor, supervisor2):
    _collab(supervisor, "0102030405", "Ana")
    _collab(supervisor2, "0102030406", "Beto")
    PeriodService.close(access(supervisor), OCT, supervisor)
    body = client_for(assistant).get(f"{BASE}/worked-days/", {"period": "2026-10"}).json()
    assert (body["supervisors_closed"], body["supervisors_total"]) == (1, 2)
    status = {r["supervisor_id"]: (r["period_status"], r["editable"]) for r in body["rows"]}
    assert status[supervisor.pk] == ("CLOSED", False)  # el cierre no se altera
    assert status[supervisor2.pk] == ("OPEN", True)


def test_saving_from_consolidated_view_goes_to_each_team(assistant, supervisor, supervisor2):
    a = _collab(supervisor, "0102030405", "Ana")
    b = _collab(supervisor2, "0102030406", "Beto")
    acc = access(assistant)
    WorkedDayService.save_cells(
        acc, OCT, supervisor, [{"collaborator_id": a.pk, "date": FRI, "hours": "8"}]
    )
    WorkedDayService.save_cells(
        acc, OCT, supervisor2, [{"collaborator_id": b.pk, "date": FRI, "hours": "6"}]
    )
    assert dict(WorkedDay.objects.values_list("collaborator_id", "supervisor_id")) == {
        a.pk: supervisor.pk,
        b.pk: supervisor2.pk,
    }


def test_supervisor_keeps_own_team_and_empty_view_has_no_errors(
    client_for, admin, supervisor, supervisor2
):
    _collab(supervisor2, "0102030406", "Beto")
    own = client_for(supervisor).get(f"{BASE}/worked-days/", {"period": "2026-10"}).json()
    assert own["supervisor"]["id"] == supervisor.pk and own["rows"] == []  # nunca la vista nacional
    other = client_for(supervisor).get(
        f"{BASE}/worked-days/", {"period": "2026-10", "supervisor": supervisor2.pk}
    )
    assert other.status_code == 403  # alcance intacto
    empty = client_for(admin).get(f"{BASE}/worked-days/", {"period": "2026-03"})
    assert empty.status_code == 200
