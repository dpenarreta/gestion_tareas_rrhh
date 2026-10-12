"""Cambios de estado de colaboradores en el Historial de registros (con su
período, marca roja y alerta) y cierre/apertura de períodos sin duplicar
novedades, personas, asignaciones ni eventos de estado."""

from datetime import date

import pytest

from apps.notifications.models import Notification
from apps.novedades.models import (
    Collaborator,
    CollaboratorAssignment,
    CollaboratorStatusChange,
    NovedadEvent,
    OperationalPeriod,
    SupervisorPeriod,
    WorkedDay,
)
from apps.novedades.periods import PeriodKey
from apps.novedades.serializers import EventSerializer
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    EventService,
    HistoryService,
    NovedadesError,
    PeriodService,
    WorkedDayService,
)

from .conftest import _user, access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
OCT = PeriodKey(2026, 10)
NOV = PeriodKey(2026, 11)
MON = date(2026, 10, 12)


def _collab(sup, cedula="0102030405", name="Ana Pérez"):
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(cedula=cedula, full_name=name, regional="Sierra", cargo="Operador"),
    )


def _status_events(collaborator):
    return NovedadEvent.objects.filter(
        action="collaborator.status_changed", target_id=str(collaborator.pk)
    )


def _status_alerts(user):
    return list(
        Notification.objects.filter(user=user, category="status_change").values_list(
            "message", flat=True
        )
    )


# ── Cambios de estado en el historial ─────────────────────────────────────────


@pytest.mark.parametrize(
    "new_status,label", [("INACTIVE", "Inactivo"), ("SUSPENDED", "Suspendido")]
)
def test_status_change_creates_complete_event_in_current_period_history(
    admin, supervisor, new_status, label
):
    c = _collab(supervisor)
    CollaboratorService.change_status(access(supervisor), c.pk, new_status, "Fin de contrato")

    event = _status_events(c).get()
    assert event.old_value == "Activo" and event.new_value == label
    assert event.actor == supervisor and event.supervisor == supervisor
    assert event.reason == "Fin de contrato" and event.created_at is not None
    assert event.target_label == "Ana Pérez (0102030405)"
    # Se asocia al período vigente: aparece en el Historial filtrado por período.
    assert event.period.key == OCT
    history = HistoryService.events(access(admin), {"period": OCT})
    assert history.filter(pk=event.pk).exists()
    # Marca roja decidida por el backend, con el estado del EVENTO.
    assert EventSerializer(event).data["highlight"] == "danger"
    # Y una alerta roja para el Administrador.
    alerts = _status_alerts(admin)
    assert len(alerts) == 1
    for fragment in ("Ana Pérez", f"de Activo a {label}", "Sup1", "Fin de contrato", "12/10/2026"):
        assert fragment in alerts[0]


def test_reactivation_is_logged_but_not_red_and_sends_no_alert(admin, supervisor):
    c = _collab(supervisor)
    CollaboratorService.change_status(access(supervisor), c.pk, "INACTIVE", "Sale")
    CollaboratorService.change_status(access(supervisor), c.pk, "ACTIVE", "")
    events = list(_status_events(c).order_by("created_at", "id"))
    assert [(e.old_value, e.new_value) for e in events] == [
        ("Activo", "Inactivo"),
        ("Inactivo", "Activo"),
    ]  # se conservan ambos, no se sobrescribe
    assert [EventSerializer(e).data["highlight"] for e in events] == ["danger", ""]
    assert len(_status_alerts(admin)) == 1


def test_legacy_status_events_without_period_still_show_in_their_period(admin, supervisor):
    """Eventos guardados antes de la corrección (período vacío, como los del
    caso reportado) aparecen en el período al que corresponde su fecha, sin
    modificarlos."""
    c = _collab(supervisor)
    CollaboratorService.change_status(access(supervisor), c.pk, "INACTIVE", "Sale")
    event = _status_events(c).get()
    NovedadEvent.objects.filter(pk=event.pk).update(period=None)

    assert HistoryService.events(access(admin), {"period": OCT}).filter(pk=event.pk).exists()
    assert not HistoryService.events(access(admin), {"period": NOV}).filter(pk=event.pk).exists()
    event.refresh_from_db()
    assert event.period is None  # no se reescribe la historia


def test_history_shows_status_events_of_all_periods(client_for, admin, supervisor):
    c = _collab(supervisor)
    CollaboratorService.change_status(access(supervisor), c.pk, "SUSPENDED", "Sanción")
    PeriodService.close(access(supervisor), OCT, supervisor)
    CollaboratorService.change_status(access(supervisor), c.pk, "INACTIVE", "Renuncia")

    body = client_for(admin).get(f"{BASE}/history/", {"action": "collaborator."}).json()
    status_rows = [r for r in body["results"] if r["action"] == "collaborator.status_changed"]
    assert {(r["new_value"], r["period"]) for r in status_rows} == {
        ("Suspendido", "2026-10"),
        ("Inactivo", "2026-11"),
    }
    assert all(r["highlight"] == "danger" for r in status_rows)


def test_failed_history_write_rolls_back_status_change(admin, supervisor, monkeypatch):
    c = _collab(supervisor)

    def boom(**kwargs):
        raise RuntimeError("fallo al guardar el historial")

    monkeypatch.setattr(EventService, "log", staticmethod(boom))
    with pytest.raises(RuntimeError):
        CollaboratorService.change_status(access(supervisor), c.pk, "INACTIVE", "Sale")
    c.refresh_from_db()
    assert c.status == "ACTIVE"
    assert not CollaboratorStatusChange.objects.filter(collaborator=c).exists()
    assert _status_alerts(admin) == []


def test_repeating_the_same_change_creates_no_duplicates(admin, supervisor, monkeypatch):
    c = _collab(supervisor)
    acc = access(supervisor)
    CollaboratorService.change_status(acc, c.pk, "INACTIVE", "Sale")
    # Reenvío del mismo cambio: mismo estado, sin evento ni alerta.
    CollaboratorService.change_status(access(supervisor), c.pk, "INACTIVE", "Sale")
    # Envío concurrente que leyó el estado viejo (doble clic): no registra nada.
    stale = Collaborator.objects.get(pk=c.pk)
    stale.status = "ACTIVE"
    monkeypatch.setattr(CollaboratorService, "_get_for_write", staticmethod(lambda a, i: stale))
    CollaboratorService.change_status(acc, c.pk, "INACTIVE", "Sale")

    assert _status_events(c).count() == 1
    assert CollaboratorStatusChange.objects.filter(collaborator=c).count() == 1
    assert len(_status_alerts(admin)) == 1


def test_status_change_permissions_and_reason(client_for, supervisor, supervisor2, assistant):
    c = _collab(supervisor)
    for user in (supervisor2, assistant):
        response = client_for(user).post(
            f"{BASE}/collaborators/{c.pk}/status/",
            {"status": "INACTIVE", "reason": "x"},
            format="json",
        )
        assert response.status_code in (403, 404)
    with pytest.raises(NovedadesError):
        CollaboratorService.change_status(access(supervisor), c.pk, "SUSPENDED", "  ")
    c.refresh_from_db()
    assert c.status == "ACTIVE" and not _status_events(c).exists()


# ── Cierre y apertura de períodos ─────────────────────────────────────────────


def test_close_keeps_statuses_and_does_not_copy_or_duplicate_anything(
    admin, supervisor, supervisor2
):
    active = _collab(supervisor, "0102030405", "Ana Activa")
    inactive = _collab(supervisor, "0102030406", "Beto Inactivo")
    suspended = _collab(supervisor, "0102030407", "Carla Suspendida")
    other_team = _collab(supervisor2, "0102030408", "Dora Otro Equipo")
    acc = access(supervisor)
    WorkedDayService.save_cells(
        acc,
        OCT,
        supervisor,
        [
            {"collaborator_id": active.pk, "date": MON, "hours": "8"},
            {"collaborator_id": inactive.pk, "date": MON, "hours": "8"},
        ],
    )
    CollaboratorService.change_status(acc, inactive.pk, "INACTIVE", "Renuncia")
    CollaboratorService.change_status(acc, suspended.pk, "SUSPENDED", "Sanción")
    counts = lambda: (  # noqa: E731
        Collaborator.objects.count(),
        CollaboratorAssignment.objects.count(),
        CollaboratorStatusChange.objects.count(),
        NovedadEvent.objects.filter(action="collaborator.status_changed").count(),
        WorkedDay.objects.count(),
    )
    before = counts()

    first = PeriodService.close(acc, OCT, supervisor)
    again = PeriodService.close(access(supervisor), OCT, supervisor)  # segundo clic

    assert first["next_period"] == "2026-11" and again["already_closed"] is True
    assert counts() == before  # sin personas, asignaciones, estados ni novedades nuevas
    assert OperationalPeriod.objects.filter(year=2026, month=11).count() == 1
    nov = SupervisorPeriod.objects.get(period__year=2026, period__month=11, supervisor=supervisor)
    assert nov.status == "OPEN"
    assert (nov.period.start_date, nov.period.end_date) == (date(2026, 10, 23), date(2026, 11, 22))
    assert SupervisorPeriod.objects.filter(supervisor=supervisor).count() == 2
    assert NovedadEvent.objects.filter(action="period.closed").count() == 1
    oct_sp = SupervisorPeriod.objects.get(period__month=10, supervisor=supervisor)
    assert oct_sp.closed_by == supervisor and oct_sp.closed_at is not None

    # Estados intactos: nadie se reactiva.
    for c, status in ((inactive, "INACTIVE"), (suspended, "SUSPENDED"), (active, "ACTIVE")):
        c.refresh_from_db()
        assert c.status == status

    # Noviembre empieza vacío: no se copian las novedades de octubre.
    nov_matrix = WorkedDayService.matrix(access(supervisor), NOV, supervisor)
    assert all(row["cells"] == {} for row in nov_matrix["rows"])
    nov_ids = {row["collaborator_id"] for row in nov_matrix["rows"]}
    assert active.pk in nov_ids and suspended.pk in nov_ids  # reglas vigentes
    assert inactive.pk not in nov_ids  # el Inactivo no entra al período nuevo

    # Octubre sigue consultable, con sus datos (incluido el ya inactivo).
    oct_matrix = WorkedDayService.matrix(access(admin), OCT, supervisor)
    oct_cells = {row["collaborator_id"]: row["cells"] for row in oct_matrix["rows"]}
    assert oct_cells[inactive.pk][MON.isoformat()]["hours"] == "8"
    assert oct_cells[active.pk][MON.isoformat()]["hours"] == "8"

    # El cierre de un supervisor no toca a los demás.
    sp2 = SupervisorPeriod.objects.get(supervisor=supervisor2)
    assert sp2.period.key == OCT and sp2.status == "OPEN"
    assert not SupervisorPeriod.objects.filter(supervisor=supervisor2, period__month=11).exists()
    other_team.refresh_from_db()
    assert other_team.status == "ACTIVE"


def test_suspended_keeps_status_until_authorized_change(supervisor):
    c = _collab(supervisor)
    acc = access(supervisor)
    CollaboratorService.change_status(acc, c.pk, "SUSPENDED", "Sanción")
    PeriodService.close(acc, OCT, supervisor)
    c.refresh_from_db()
    assert c.status == "SUSPENDED"
    CollaboratorService.change_status(access(supervisor), c.pk, "ACTIVE", "")
    c.refresh_from_db()
    assert c.status == "ACTIVE"
    assert _status_events(c).count() == 2


def test_close_requires_permission_and_scope(supervisor, supervisor2, assistant):
    _collab(supervisor)
    for user in (supervisor2, assistant):
        with pytest.raises(NovedadesError):
            PeriodService.close(access(user), OCT, supervisor)
    assert not SupervisorPeriod.objects.filter(status="CLOSED").exists()


def test_other_admin_receives_status_alert_when_admin_changes(admin, supervisor):
    other_admin = _user("admin2", "ADMINISTRADOR", superuser=True)
    c = _collab(supervisor)
    CollaboratorService.change_status(access(admin), c.pk, "INACTIVE", "Baja")
    assert len(_status_alerts(other_admin)) == 1
    assert _status_alerts(admin) == []  # quien hace el cambio no se alerta a sí mismo
