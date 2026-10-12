"""Reglas de negocio del módulo (servicios), incluidas las restricciones
obligatorias de ámbito y de períodos cerrados."""

from datetime import date
from decimal import Decimal

import pytest

from apps.novedades.models import (
    Collaborator,
    CollaboratorStatusChange,
    NovedadEvent,
    OvertimeRecord,
    SupervisorPeriod,
    WorkedDay,
)
from apps.novedades.periods import PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    CorrectionService,
    NovedadesError,
    OvertimeService,
    PeriodService,
    WorkedDayService,
)

from .conftest import access, admin_notifications

pytestmark = pytest.mark.django_db

OCT = PeriodKey(2026, 10)
MON = date(2026, 10, 12)
TUE = date(2026, 10, 13)
SAT = date(2026, 10, 10)
SUN = date(2026, 10, 11)


def _collab(sup, cedula="0102030405", name="Ana Pérez"):
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(
            cedula=cedula, full_name=name, regional="Sierra", area="Bodega", cargo="Operador"
        ),
    )


# ── Colaboradores ─────────────────────────────────────────────────────────────


def test_supervisor_creates_collaborator_without_approval_and_admin_is_notified(admin, supervisor):
    c = _collab(supervisor)
    assert c.current_supervisor == supervisor and c.status == Collaborator.Status.ACTIVE
    messages = admin_notifications(admin)
    assert len(messages) == 1
    msg = messages[0]
    for fragment in (
        "Ana Pérez",
        "0102030405",
        "Operador",
        "Bodega",
        "Sierra",
        "Sup1",
        "Octubre 2026",
    ):
        assert fragment in msg


def test_no_duplicates_by_cedula_and_no_takeover_of_other_supervisor(
    admin, supervisor, supervisor2
):
    _collab(supervisor)
    with pytest.raises(NovedadesError) as same:
        _collab(supervisor, cedula="0102030405")
    assert same.value.code == "duplicate"
    with pytest.raises(NovedadesError) as other:
        _collab(supervisor2, cedula="01020-30405")
    assert other.value.code == "assigned_to_other"
    assert Collaborator.objects.count() == 1
    assert Collaborator.objects.get().current_supervisor == supervisor
    assert any("Reasignación solicitada" in m for m in admin_notifications(admin))


def test_status_change_requires_reason_notifies_and_keeps_history(admin, supervisor):
    c = _collab(supervisor)
    WorkedDayService.save_cells(
        access(supervisor), OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "8"}]
    )
    with pytest.raises(NovedadesError):
        CollaboratorService.change_status(access(supervisor), c.pk, "SUSPENDED", "")
    CollaboratorService.change_status(
        access(supervisor), c.pk, "SUSPENDED", "Sanción disciplinaria"
    )
    c.refresh_from_db()
    assert c.status == "SUSPENDED"
    assert CollaboratorStatusChange.objects.filter(collaborator=c, new_status="SUSPENDED").exists()
    assert WorkedDay.objects.get(collaborator=c).hours == Decimal("8.00")
    assert any(
        "Suspendido" in m and "Sanción disciplinaria" in m for m in admin_notifications(admin)
    )
    # Un suspendido no admite nuevas novedades.
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            access(supervisor),
            OCT,
            supervisor,
            [{"collaborator_id": c.pk, "date": TUE, "hours": "8"}],
        )
    assert exc.value.details["cells"][0]["message"].endswith("no admite nuevos registros.")


def test_supervisor_cannot_touch_other_team(supervisor, supervisor2):
    c = _collab(supervisor)
    with pytest.raises(NovedadesError) as exc:
        CollaboratorService.update(access(supervisor2), c.pk, {"full_name": "X"})
    assert exc.value.status == 404
    with pytest.raises(NovedadesError):
        WorkedDayService.matrix(access(supervisor2), OCT, supervisor)
    with pytest.raises(NovedadesError):
        WorkedDayService.save_cells(
            access(supervisor2),
            OCT,
            supervisor,
            [{"collaborator_id": c.pk, "date": MON, "hours": "8"}],
        )


def test_only_admin_reassigns(admin, supervisor, supervisor2):
    c = _collab(supervisor)
    with pytest.raises(NovedadesError):
        CollaboratorService.reassign(access(supervisor2), c.pk, supervisor2.pk, "me lo llevo")
    CollaboratorService.reassign(access(admin), c.pk, supervisor2.pk, "Cambio de zona")
    c.refresh_from_db()
    assert c.current_supervisor == supervisor2
    assert c.assignments.count() == 2


# ── Días laborados ────────────────────────────────────────────────────────────


def test_empty_is_not_zero_and_values_persist(supervisor):
    c = _collab(supervisor)
    acc = access(supervisor)
    WorkedDayService.save_cells(
        acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "0"}]
    )
    matrix = WorkedDayService.matrix(acc, OCT, supervisor)
    row = matrix["rows"][0]
    assert row["cells"][MON.isoformat()]["hours"] == "0"
    assert TUE.isoformat() not in row["cells"]
    assert row["cut_label"] == "Octubre 2026: 23/09/2026 – 22/10/2026"
    assert [c["date"] for c in matrix["columns"]][0] == "2026-09-23"
    assert len(matrix["columns"]) == 30
    weekend_cols = {c["date"] for c in matrix["columns"] if c["is_weekend"]}
    assert (
        SAT.isoformat() in weekend_cols
        and SUN.isoformat() in weekend_cols
        and MON.isoformat() not in weekend_cols
    )


@pytest.mark.parametrize("day", [SAT, SUN])
def test_weekend_cells_rejected_in_backend(supervisor, day):
    c = _collab(supervisor)
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            access(supervisor),
            OCT,
            supervisor,
            [{"collaborator_id": c.pk, "date": day, "hours": "8"}],
        )
    assert "sábado y domingo" in exc.value.details["cells"][0]["message"]
    assert not WorkedDay.objects.exists()


def test_invalid_values_and_dates_outside_period_are_rejected(supervisor):
    c = _collab(supervisor)
    acc = access(supervisor)
    for hours in ("-1", "25", "abc", "8.555"):
        with pytest.raises(NovedadesError):
            WorkedDayService.save_cells(
                acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": hours}]
            )
    with pytest.raises(NovedadesError):
        WorkedDayService.save_cells(
            acc,
            OCT,
            supervisor,
            [{"collaborator_id": c.pk, "date": date(2026, 10, 26), "hours": "8"}],
        )


def test_optimistic_concurrency_conflict(supervisor):
    c = _collab(supervisor)
    acc = access(supervisor)
    WorkedDayService.save_cells(
        acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "8"}]
    )
    WorkedDayService.save_cells(
        acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "6", "version": 1}]
    )
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            acc,
            OCT,
            supervisor,
            [{"collaborator_id": c.pk, "date": MON, "hours": "4", "version": 1}],
        )
    assert exc.value.status == 409
    assert WorkedDay.objects.get().hours == Decimal("6.00")


def test_assistant_never_writes(assistant, supervisor):
    c = _collab(supervisor)
    acc = access(assistant)
    assert acc.national_read and not acc.can_write_for_supervisor(supervisor.pk)
    with pytest.raises(NovedadesError):
        WorkedDayService.save_cells(
            acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "8"}]
        )
    with pytest.raises(NovedadesError):
        OvertimeService.create(acc, {"collaborator_id": c.pk, "date": MON, "overtime_hours": "2"})
    # Pero sí lee el consolidado nacional.
    OvertimeService.create(
        access(supervisor), {"collaborator_id": c.pk, "date": MON, "overtime_hours": "2"}
    )
    assert OvertimeService.queryset_for(acc).count() == 1


# ── Horas extras ──────────────────────────────────────────────────────────────


def test_overtime_allows_weekends_detects_duplicates_and_keeps_supervisor(
    admin, supervisor, supervisor2
):
    c = _collab(supervisor)
    acc = access(supervisor)
    record = OvertimeService.create(
        acc, {"collaborator_id": c.pk, "date": SAT, "saturday_hours": "4"}
    )
    assert record.is_saturday and not record.is_sunday and record.supervisor == supervisor
    with pytest.raises(NovedadesError) as exc:
        OvertimeService.create(acc, {"collaborator_id": c.pk, "date": SAT, "overtime_hours": "1"})
    assert exc.value.code == "duplicate"
    CollaboratorService.reassign(access(admin), c.pk, supervisor2.pk, "Cambio")
    record.refresh_from_db()
    assert record.supervisor == supervisor  # la historia conserva al responsable original


def test_overtime_update_delete_and_scope(supervisor, supervisor2):
    c = _collab(supervisor)
    acc = access(supervisor)
    record = OvertimeService.create(
        acc, {"collaborator_id": c.pk, "date": MON, "overtime_hours": "2"}
    )
    with pytest.raises(NovedadesError):
        OvertimeService.update(access(supervisor2), record.pk, {"overtime_hours": "3"})
    OvertimeService.update(acc, record.pk, {"overtime_hours": "3", "version": 1})
    record.refresh_from_db()
    assert record.overtime_hours == Decimal("3.00") and record.version == 2
    OvertimeService.delete(acc, record.pk, "Error de digitación")
    record.refresh_from_db()
    assert record.deleted_at is not None  # borrado lógico
    assert OvertimeRecord.objects.count() == 1


def test_overtime_indicators_respect_filters(supervisor, supervisor2):
    a = _collab(supervisor)
    b = _collab(supervisor2, cedula="0911111111", name="Beto")
    OvertimeService.create(
        access(supervisor), {"collaborator_id": a.pk, "date": MON, "overtime_hours": "2"}
    )
    OvertimeService.create(
        access(supervisor2),
        {"collaborator_id": b.pk, "date": TUE, "overtime_hours": "1.5", "saturday_hours": "1"},
    )
    qs = OvertimeService.filter(
        OvertimeRecord.objects.filter(deleted_at__isnull=True), {"period": OCT}
    )
    assert OvertimeService.indicators(qs) == {
        "records": 2,
        "overtime_hours": "3.5",
        "saturday_hours": "1",
        "supervisors_reporting": 2,
    }
    only_b = OvertimeService.filter(qs, {"supervisor": supervisor2.pk})
    assert OvertimeService.indicators(only_b)["records"] == 1


# ── Cierre ────────────────────────────────────────────────────────────────────


def test_close_is_individual_atomic_idempotent_and_opens_next_period(
    admin, supervisor, supervisor2
):
    c = _collab(supervisor)
    c2 = _collab(supervisor2, cedula="0922222222", name="Carla")
    acc = access(supervisor)
    WorkedDayService.save_cells(
        acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "8"}]
    )
    OvertimeService.create(acc, {"collaborator_id": c.pk, "date": MON, "overtime_hours": "2"})

    summary = PeriodService.close_summary(acc, OCT, supervisor)
    assert summary["active_collaborators"] == 1 and summary["worked_day_cells"] == 1
    assert summary["pending_cells"] > 0

    result = PeriodService.close(acc, OCT, supervisor)
    assert result["already_closed"] is False and result["next_period"] == "2026-11"
    again = PeriodService.close(acc, OCT, supervisor)
    assert again["already_closed"] is True
    assert SupervisorPeriod.objects.filter(supervisor=supervisor).count() == 2

    # Edición ordinaria bloqueada para ese supervisor y período.
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": TUE, "hours": "8"}]
        )
    assert exc.value.code == "period_closed"
    with pytest.raises(NovedadesError):
        OvertimeService.create(acc, {"collaborator_id": c.pk, "date": TUE, "overtime_hours": "1"})

    # El otro supervisor sigue trabajando en octubre.
    WorkedDayService.save_cells(
        access(supervisor2),
        OCT,
        supervisor2,
        [{"collaborator_id": c2.pk, "date": MON, "hours": "8"}],
    )

    # Noviembre: misma base de colaboradores, sin novedades copiadas.
    nov = WorkedDayService.matrix(acc, PeriodKey(2026, 11), supervisor)
    assert [r["collaborator_id"] for r in nov["rows"]] == [c.pk]
    assert nov["rows"][0]["cells"] == {}
    assert nov["editable"] is True
    assert any("cerró Octubre 2026" in m for m in admin_notifications(admin))


def test_cannot_close_a_period_that_is_not_the_current_one(supervisor):
    _collab(supervisor)
    with pytest.raises(NovedadesError) as exc:
        PeriodService.close(access(supervisor), PeriodKey(2026, 11), supervisor)
    assert exc.value.code == "wrong_period"


def test_correction_after_close_is_audited_and_keeps_original(admin, supervisor):
    c = _collab(supervisor)
    acc = access(supervisor)
    WorkedDayService.save_cells(
        acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "8"}]
    )
    PeriodService.close(acc, OCT, supervisor)
    with pytest.raises(NovedadesError):
        CorrectionService.correct_worked_day(
            acc, collaborator_id=c.pk, supervisor_id=supervisor.pk, day=MON, hours="6", reason="x"
        )
    correction = CorrectionService.correct_worked_day(
        access(admin),
        collaborator_id=c.pk,
        supervisor_id=supervisor.pk,
        day=MON,
        hours="6",
        reason="Ajuste RRHH",
    )
    assert correction.original_values == {"hours": "8"} and correction.new_values == {"hours": "6"}
    assert WorkedDay.objects.get().hours == Decimal("6.00")
    assert NovedadEvent.objects.filter(
        action="correction.worked_day", reason="Ajuste RRHH"
    ).exists()
