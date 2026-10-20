"""Administración de Días laborados (pedido del 2026-10-16, decisiones del
usuario): el Administrador RETIRA a un colaborador (eliminación lógica: deja
de aparecer desde el período en curso, todo se conserva y se puede restaurar)
y CORRIGE su cédula aunque la haya registrado un Supervisor."""

from datetime import date
from decimal import Decimal

import pytest

from apps.novedades.models import (
    Collaborator,
    CollaboratorExitNotification,
    NovedadEvent,
    OvertimeRecord,
    SupervisorPeriod,
    WorkedDay,
)
from apps.novedades.periods import PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    NovedadesError,
    OvertimeService,
    PeriodService,
    WorkedDayService,
)

from .conftest import _user, access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
OCT, SEP = PeriodKey(2026, 10), PeriodKey(2026, 9)
FRI = date(2026, 10, 9)


def _collab(sup, cedula="0102030405", name="Ana Pérez"):
    PeriodService.ensure_current(sup)
    return CollaboratorService.create(access(sup), CollaboratorInput(cedula=cedula, full_name=name))


def _row_ids(user, sup, key=OCT):
    return {r["collaborator_id"] for r in WorkedDayService.matrix(access(user), key, sup)["rows"]}


@pytest.fixture
def ana(supervisor, admin):
    c = _collab(supervisor)
    WorkedDayService.save_cells(
        access(supervisor), OCT, supervisor, [{"collaborator_id": c.pk, "date": FRI, "hours": "8"}]
    )
    OvertimeService.create(
        access(supervisor),
        {"collaborator_id": c.pk, "date": FRI, "overtime_hours": "2", "work_done": "Inventario"},
    )
    return c


# ── Retiro lógico ─────────────────────────────────────────────────────────────


def test_admin_removes_logically_and_everything_is_kept(client_for, admin, supervisor, ana):
    beto = _collab(supervisor, "0102030406", "Beto Ríos")
    response = client_for(admin).post(
        f"{BASE}/collaborators/{ana.pk}/remove-worked-days/",
        {"reason": "Registrado por error"},
        format="json",
    )
    assert response.status_code == 200, response.json()
    assert response.json()["worked_days_removed_reason"] == "Registrado por error"
    # Fuera de Días laborados del período en curso (y del resumen de cierre)...
    assert _row_ids(supervisor, supervisor) == {beto.pk}
    summary = PeriodService.close_summary(access(supervisor), OCT, supervisor)
    assert summary["collaborators"] == 1 and summary["worked_day_cells"] == 0
    # ...pero el registro maestro, sus días, horas extras y estado se conservan.
    ana.refresh_from_db()
    assert ana.status == "ACTIVE" and ana.worked_days_removed_by == admin
    assert WorkedDay.objects.get(collaborator=ana, date=FRI).hours == Decimal("8")
    assert OvertimeRecord.objects.filter(collaborator=ana, deleted_at__isnull=True).count() == 1
    assert not CollaboratorExitNotification.objects.exists()  # no es una salida
    event = NovedadEvent.objects.get(action="collaborator.removed_from_worked_days")
    assert event.actor == admin and event.reason == "Registrado por error"
    assert "se conservan 1 día(s)" in event.new_value and event.target_id == str(ana.pk)


def test_earlier_periods_still_show_the_collaborator(admin, supervisor, ana):
    sep = PeriodService.get_period(SEP)
    WorkedDay.objects.create(
        collaborator=ana,
        period=sep,
        supervisor=supervisor,
        date=date(2026, 9, 15),
        hours=Decimal("8"),
        updated_by=supervisor,
    )
    SupervisorPeriod.objects.get_or_create(
        period=sep, supervisor=supervisor, defaults={"status": SupervisorPeriod.Status.CLOSED}
    )
    CollaboratorService.remove_from_worked_days(access(admin), ana.pk, "Retiro")
    assert ana.pk in _row_ids(admin, supervisor, SEP)  # la historia anterior, intacta
    assert ana.pk not in _row_ids(admin, supervisor, OCT)


def test_removed_collaborator_rejects_new_cells_until_restored(client_for, admin, supervisor, ana):
    CollaboratorService.remove_from_worked_days(access(admin), ana.pk, "Retiro")
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            access(supervisor),
            OCT,
            supervisor,
            [{"collaborator_id": ana.pk, "date": date(2026, 10, 8), "hours": "8"}],
        )
    assert {c["code"] for c in exc.value.details["cells"]} == {"removed"}

    restored = client_for(admin).post(
        f"{BASE}/collaborators/{ana.pk}/restore-worked-days/",
        {"reason": "Se retiró por error"},
        format="json",
    )
    assert restored.status_code == 200 and restored.json()["worked_days_removed_at"] is None
    assert ana.pk in _row_ids(supervisor, supervisor)
    WorkedDayService.save_cells(
        access(supervisor),
        OCT,
        supervisor,
        [{"collaborator_id": ana.pk, "date": date(2026, 10, 8), "hours": "8"}],
    )
    assert NovedadEvent.objects.filter(action="collaborator.restored_to_worked_days").exists()


def test_remove_requires_reason_and_is_not_repeated(admin, ana):
    with pytest.raises(NovedadesError) as exc:
        CollaboratorService.remove_from_worked_days(access(admin), ana.pk, "  ")
    assert exc.value.details == {"reason": ["Obligatorio."]}
    CollaboratorService.remove_from_worked_days(access(admin), ana.pk, "Retiro")
    with pytest.raises(NovedadesError) as exc:
        CollaboratorService.remove_from_worked_days(access(admin), ana.pk, "Otra vez")
    assert exc.value.status == 409
    assert NovedadEvent.objects.filter(action="collaborator.removed_from_worked_days").count() == 1


# ── Corrección de cédula ──────────────────────────────────────────────────────


def test_admin_corrects_cedula_registered_by_supervisor(client_for, admin, supervisor, ana):
    response = client_for(admin).post(
        f"{BASE}/collaborators/{ana.pk}/cedula/",
        {"cedula": " 1712-345 678 ", "reason": "Error de digitación"},
        format="json",
    )
    assert response.status_code == 200, response.json()
    assert response.json()["cedula"] == "1712345678"  # normalizada como en el alta
    ana.refresh_from_db()
    assert ana.cedula == "1712345678"
    # Las relaciones siguen intactas: mismo colaborador, mismos días y horas.
    row = next(
        r
        for r in WorkedDayService.matrix(access(supervisor), OCT, supervisor)["rows"]
        if r["collaborator_id"] == ana.pk
    )
    assert row["cedula"] == "1712345678" and row["cells"][FRI.isoformat()]["hours"] == "8"
    assert OvertimeRecord.objects.get(collaborator=ana).collaborator.cedula == "1712345678"
    # Nombre, cargo y supervisor no cambian.
    assert (ana.full_name, ana.current_supervisor) == ("Ana Pérez", supervisor)
    event = NovedadEvent.objects.get(action="collaborator.cedula_changed")
    assert (event.old_value, event.new_value, event.actor, event.reason) == (
        "0102030405",
        "1712345678",
        admin,
        "Error de digitación",
    )
    assert event.created_at is not None


@pytest.mark.parametrize(
    "value, code",
    [
        ("", "invalid"),
        ("12345", "invalid"),
        ("0102030405!", "invalid"),
        ("1" * 21, "invalid"),
        ("0102030405", "unchanged"),
    ],
)
def test_invalid_cedulas_are_rejected(admin, ana, value, code):
    with pytest.raises(NovedadesError) as exc:
        CollaboratorService.change_cedula(access(admin), ana.pk, value, "Corrección")
    assert exc.value.code == code
    ana.refresh_from_db()
    assert ana.cedula == "0102030405"


def test_duplicate_cedula_is_detected(client_for, admin, supervisor, supervisor2, ana):
    other = _collab(supervisor2, "0999999999", "Otro Equipo")
    response = client_for(admin).post(
        f"{BASE}/collaborators/{ana.pk}/cedula/",
        {"cedula": "0999999999", "reason": "x"},
        format="json",
    )
    assert response.status_code == 409
    assert "ya pertenece a Otro Equipo" in response.json()["error"]["message"]
    ana.refresh_from_db()
    other.refresh_from_db()
    assert (ana.cedula, other.cedula) == ("0102030405", "0999999999")


# ── Permisos ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("who", ["supervisor", "assistant", "jefe"])
def test_only_admin_can_remove_restore_or_change_cedula(client_for, request, admin, ana, who):
    user = _user("jefe", "JEFE_OPERACIONES") if who == "jefe" else request.getfixturevalue(who)
    c = client_for(user)
    for path, body in (
        ("remove-worked-days", {"reason": "x"}),
        ("restore-worked-days", {"reason": "x"}),
        ("cedula", {"cedula": "1712345678", "reason": "x"}),
    ):
        r = c.post(f"{BASE}/collaborators/{ana.pk}/{path}/", body, format="json")
        assert r.status_code == 403, (who, path, r.status_code)
    ana.refresh_from_db()
    assert ana.cedula == "0102030405" and ana.worked_days_removed_at is None


def test_supervisor_edit_still_cannot_change_cedula(client_for, supervisor, ana):
    response = client_for(supervisor).patch(
        f"{BASE}/collaborators/{ana.pk}/",
        {"cedula": "1712345678", "full_name": "Ana María Pérez"},
        format="json",
    )
    assert response.status_code == 200
    ana.refresh_from_db()
    assert ana.cedula == "0102030405" and ana.full_name == "Ana María Pérez"


def test_hard_delete_without_history_still_works(admin, supervisor):
    nueva = _collab(supervisor, "0102030499", "Sin Historia")
    CollaboratorService.delete(access(admin), nueva.pk, "Duplicado")
    assert not Collaborator.objects.filter(pk=nueva.pk).exists()
