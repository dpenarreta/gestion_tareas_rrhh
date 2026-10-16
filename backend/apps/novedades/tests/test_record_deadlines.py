"""Plazo de registro por fecha de trabajo (Días laborados y Horas extras),
fechas futuras, excepción del Asistente/Administrador y su configuración en
Ajustes (pedido del 2026-10-13; reglas en `RecordDeadlineService`).

Regla: horas laborables (24 h por día hábil, lunes a viernes sin feriados)
desde el FIN del día de trabajo, hora de Ecuador. Valor inicial 48 h."""

import io
from datetime import date, datetime
from datetime import timezone as dt_timezone

import openpyxl
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.configuration.models import Holiday
from apps.novedades import access as perms
from apps.novedades.excel import OVERTIME_HEADERS
from apps.novedades.models import NovedadEvent, OvertimeMonthClose, OvertimeRecord, WorkedDay
from apps.novedades.periods import MonthKey, PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    NovedadesError,
    OvertimeService,
    PermissionAdminService,
    RecordDeadlineService,
    WorkedDayService,
    deadline_label,
)

from .conftest import access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
UTC = dt_timezone.utc
WD, OT = RecordDeadlineService.WORKED_DAYS, RecordDeadlineService.OVERTIME


@pytest.fixture
def clock(monkeypatch):
    def set_clock(day, now):
        monkeypatch.setattr("apps.novedades.services.today", lambda: day)
        monkeypatch.setattr("apps.novedades.views.today", lambda: day)
        monkeypatch.setattr("django.utils.timezone.now", lambda: now)

    return set_clock


def _collab(sup, cedula="0102030405", name="Ana Pérez"):
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(cedula=cedula, full_name=name, regional="Sierra", cargo="Operador"),
    )


def _cell(acc, sup, c, day, hours="8"):
    return WorkedDayService.save_cells(
        acc,
        PeriodKey(2026, 10) if day <= date(2026, 10, 22) else PeriodKey(2026, 11),
        sup,
        [{"collaborator_id": c.pk, "date": day, "hours": hours}],
    )


def _ot(acc, c, day, hours="2"):
    return OvertimeService.create(
        acc, {"collaborator_id": c.pk, "date": day, "overtime_hours": hours}
    )


# ── A. Cálculo del plazo ───────────────────────────────────────────────────────


def test_deadline_counts_business_hours_from_end_of_work_day():
    # Martes 13 → hasta el jueves 15 23:59 (Ecuador).
    tue = RecordDeadlineService.deadline(WD, date(2026, 10, 13), set())
    assert tue == datetime(2026, 10, 16, 5, tzinfo=UTC)
    assert deadline_label(tue) == "jueves 15/10/2026 23:59"
    # Viernes 16 → el fin de semana no consume plazo: hasta el martes 20 23:59.
    fri = RecordDeadlineService.deadline(OT, date(2026, 10, 16), set())
    assert deadline_label(fri) == "martes 20/10/2026 23:59"
    # Feriado en medio: se salta.
    with_holiday = RecordDeadlineService.deadline(WD, date(2026, 10, 13), {date(2026, 10, 14)})
    assert deadline_label(with_holiday) == "viernes 16/10/2026 23:59"
    # Cambio de mes: viernes 30/10 → martes 03/11 23:59.
    assert deadline_label(RecordDeadlineService.deadline(OT, date(2026, 10, 30), set())) == (
        "martes 03/11/2026 23:59"
    )


def test_deadline_uses_configured_holidays():
    Holiday.objects.create(date=date(2026, 11, 2), name="Difuntos", year=2026)
    assert deadline_label(RecordDeadlineService.deadline(OT, date(2026, 10, 30))) == (
        "miércoles 04/11/2026 23:59"
    )


def test_exact_deadline_boundary(clock, supervisor):
    c = _collab(supervisor)
    work = date(2026, 10, 9)  # viernes → plazo hasta el martes 13 23:59 (14/10 05:00 UTC)
    clock(date(2026, 10, 13), datetime(2026, 10, 14, 4, 59, 59, tzinfo=UTC))
    _cell(access(supervisor), supervisor, c, work)  # un segundo antes: permitido
    clock(date(2026, 10, 14), datetime(2026, 10, 14, 5, tzinfo=UTC))
    with pytest.raises(NovedadesError) as exc:
        _cell(access(supervisor), supervisor, c, work, "6")  # en el límite: vencido
    assert exc.value.details["cells"][0]["code"] == "deadline_passed"
    assert WorkedDay.objects.get().hours == 8


# ── A. Fechas futuras ──────────────────────────────────────────────────────────


def test_future_dates_are_rejected_for_every_role(admin, supervisor, assistant):
    c = _collab(supervisor)
    future = date(2026, 10, 13)  # hoy es el lunes 12/10
    for user in (supervisor, assistant, admin):
        with pytest.raises(NovedadesError) as exc:
            _cell(access(user), supervisor, c, future)
        assert exc.value.details["cells"][0]["code"] == "future_date"
        with pytest.raises(NovedadesError) as exc:
            _ot(access(user), c, future)
        assert exc.value.code == "future_date"
    assert not WorkedDay.objects.exists() and not OvertimeRecord.objects.exists()


# ── B. Supervisor vs. Asistente / Administrador ────────────────────────────────


def test_supervisor_blocked_after_deadline_in_every_write_path(client_for, admin, supervisor):
    c = _collab(supervisor)
    old = date(2026, 10, 5)  # lunes 05 → venció el miércoles 07 23:59
    record = _ot(access(admin), c, old)  # existe (registrado por excepción)
    acc = access(supervisor)
    with pytest.raises(NovedadesError) as exc:
        _cell(acc, supervisor, c, old)
    assert exc.value.details["cells"][0]["code"] == "deadline_passed"
    for action in (
        lambda: _ot(acc, _collab(supervisor, "0102030406", "Beto"), old),
        lambda: OvertimeService.update(acc, record.pk, {"overtime_hours": "5", "version": 1}),
        lambda: OvertimeService.delete(acc, record.pk, "x"),
    ):
        with pytest.raises(NovedadesError) as exc:
            action()
        assert exc.value.code == "deadline_passed"
    bulk = OvertimeService.bulk_save(
        acc,
        MonthKey(2026, 10),
        [
            {
                "client_key": "a",
                "id": record.pk,
                "version": 1,
                "collaborator_id": c.pk,
                "date": old,
                "overtime_hours": "9",
            }
        ],
    )
    assert bulk["rows"][0]["status"] == "locked"
    # Llamada directa a la API: también rechazada.
    response = client_for(supervisor).patch(
        f"{BASE}/overtime/{record.pk}/", {"overtime_hours": "9"}, format="json"
    )
    assert response.status_code == 409
    record.refresh_from_db()
    assert str(record.overtime_hours) == "2.00" and record.deleted_at is None


def test_assistant_and_admin_correct_expired_dates_and_it_is_audited(admin, supervisor, assistant):
    c = _collab(supervisor)
    old = date(2026, 10, 5)
    _cell(access(assistant), supervisor, c, old, "8")
    _cell(access(admin), supervisor, c, old, "7")
    record = _ot(access(assistant), c, old)
    OvertimeService.update(access(admin), record.pk, {"overtime_hours": "3", "version": 1})
    assert WorkedDay.objects.get().hours == 7
    late = NovedadEvent.objects.filter(reason=RecordDeadlineService.LATE_REASON)
    assert set(late.values_list("action", flat=True)) >= {
        "worked_day.created",
        "worked_day.updated",
        "overtime.created",
        "overtime.updated",
    }
    assert set(late.values_list("actor__username", flat=True)) == {"asis", "admin"}


def test_within_deadline_events_are_not_marked_late(supervisor):
    c = _collab(supervisor)
    _cell(access(supervisor), supervisor, c, date(2026, 10, 9))
    assert NovedadEvent.objects.filter(action="worked_day.created", reason="").exists()


def test_exception_does_not_bypass_closed_month_or_closed_period(admin, supervisor, assistant):
    c = _collab(supervisor)
    OvertimeMonthClose.objects.create(supervisor=supervisor, year=2026, month=9, closed_by=admin)
    with pytest.raises(NovedadesError) as exc:
        _ot(access(assistant), c, date(2026, 9, 15))
    assert exc.value.code == "period_closed"
    # Cierre 23 → 22 de Días laborados: tampoco.
    from apps.novedades.services import PeriodService

    PeriodService.close(access(supervisor), PeriodKey(2026, 10), supervisor)
    with pytest.raises(NovedadesError) as exc:
        _cell(access(assistant), supervisor, c, date(2026, 10, 5))
    assert exc.value.code == "period_closed"


def test_assistant_registrar_can_be_turned_off_by_admin(admin, assistant, supervisor):
    c = _collab(supervisor)
    PermissionAdminService.set_role_permission(
        access(admin),
        role=perms.ASSISTANT_ROLE,
        codename=perms.REGISTRAR,
        enabled=False,
        reason="Pausa",
    )
    with pytest.raises(NovedadesError):
        _ot(access(assistant), c, date(2026, 10, 9))


# ── Matriz e informe a la pantalla ─────────────────────────────────────────────


def test_matrix_and_me_report_deadline_state_per_user(client_for, supervisor, assistant):
    _collab(supervisor)
    by_date = lambda m: {c["date"]: c["deadline_state"] for c in m["columns"]}  # noqa: E731
    sup = by_date(WorkedDayService.matrix(access(supervisor), PeriodKey(2026, 10), supervisor))
    asis = by_date(WorkedDayService.matrix(access(assistant), PeriodKey(2026, 10), supervisor))
    assert sup["2026-10-05"] == "expired" and asis["2026-10-05"] == "late"
    assert sup["2026-10-09"] == "" and sup["2026-10-12"] == ""
    assert sup["2026-10-13"] == "future" and asis["2026-10-13"] == "future"
    me = client_for(supervisor).get(f"{BASE}/me/").json()
    rules = me["deadline_rules"]
    assert rules["can_bypass_deadline"] is False and rules["worked_days"]["hours"] == 48
    # Lunes 12, 12:00: el jueves 08 sigue en plazo (sus 48 h son el viernes 09 y
    # el lunes 12: vence el lunes 23:59); el miércoles 07 ya venció.
    assert rules["worked_days"]["earliest_open_date"] == "2026-10-08"
    assert client_for(assistant).get(f"{BASE}/me/").json()["deadline_rules"]["can_bypass_deadline"]


# ── Ajustes: solo el Administrador ─────────────────────────────────────────────


def test_settings_only_admin_can_change_and_it_is_audited(client_for, admin, supervisor, assistant):
    url = f"{BASE}/deadlines/settings/"
    for user in (supervisor, assistant):
        assert client_for(user).get(url).status_code == 200  # consulta
        assert client_for(user).patch(url, {"worked_days": 72}, format="json").status_code == 403
    assert client_for(admin).patch(url, {"worked_days": 23}, format="json").status_code == 400
    response = client_for(admin).patch(url, {"worked_days": 72}, format="json")
    assert response.status_code == 200
    items = {i["kind"]: i for i in response.json()["items"]}
    assert (
        items["worked_days"]["hours"] == 72 and items["overtime"]["hours"] == 48
    )  # independientes
    assert items["worked_days"]["updated_by"] == "Admin" and items["worked_days"]["updated_at"]
    event = NovedadEvent.objects.get(action="deadline.changed")
    assert (event.old_value, event.new_value) == ("48", "72")


def test_setting_change_is_not_retroactive(clock, client_for, admin):
    # Cambiado el lunes 12 a las 12:00: aplica a fechas cuyo plazo empieza después.
    client_for(admin).patch(f"{BASE}/deadlines/settings/", {"overtime": 72}, format="json")
    assert RecordDeadlineService.hours_for(OT, date(2026, 10, 9)) == 48  # plazo ya en curso
    assert RecordDeadlineService.hours_for(OT, date(2026, 10, 12)) == 72  # empieza el 13
    assert RecordDeadlineService.hours_for(WD, date(2026, 10, 12)) == 48  # el otro no cambia


# ── Importaciones: mismo plazo, informado en la vista previa ──────────────────


def test_import_preview_flags_expired_and_future_rows_for_supervisor(client_for, admin, supervisor):
    PermissionAdminService.create_override(
        access(admin), user_id=supervisor.pk, codename=perms.IMPORTAR, effect="GRANT", reason="x"
    )
    _collab(supervisor)
    rows = [
        OVERTIME_HEADERS,
        [date(2026, 10, 5), "0102030405", "Ana Pérez", "", "", "", 2, 0, "NO", "NO", "NO", "x", ""],
        [date(2026, 10, 9), "0102030405", "Ana Pérez", "", "", "", 2, 0, "NO", "NO", "NO", "x", ""],
    ]
    wb = openpyxl.Workbook()
    for row in rows:
        wb.active.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    body = (
        client_for(supervisor)
        .post(
            f"{BASE}/imports/preview/",
            {
                "kind": "OVERTIME",
                "period": "2026-10",
                "file": SimpleUploadedFile("h.xlsx", buffer.getvalue()),
            },
            format="multipart",
        )
        .json()
    )
    assert body["summary"]["valid_rows"] == 1 and body["summary"]["invalid_rows"] == 1
    assert "venció" in body["errors"][0]["message"]


# ── Vencer una fecha no cierra el mes ──────────────────────────────────────────


def test_individual_deadline_is_independent_from_monthly_close(clock, admin, supervisor):
    c = _collab(supervisor)
    clock(date(2026, 11, 10), datetime(2026, 11, 10, 15, tzinfo=UTC))
    with pytest.raises(NovedadesError) as exc:
        _ot(access(supervisor), c, date(2026, 10, 30))
    assert exc.value.code == "deadline_passed"
    assert not OvertimeMonthClose.objects.exists()  # el mes sigue abierto
    _ot(access(admin), c, date(2026, 10, 30))  # y la excepción puede registrar
