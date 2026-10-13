"""Horas extras por MES CALENDARIO: plazo de 48–72 horas laborables para el
mes anterior, sin cierre automático (vencido solo avisa), cierre manual por
equipo, bloqueo de toda escritura tras el cierre y corrección autorizada.

Reloj controlado: `today()` del módulo y `timezone.now()` se fijan por test."""

import io
from datetime import date, datetime
from datetime import timezone as dt_timezone

import openpyxl
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.configuration.models import Holiday
from apps.notifications.models import Notification
from apps.novedades.excel import OVERTIME_HEADERS
from apps.novedades.models import (
    ClosedPeriodCorrection,
    NovedadEvent,
    OvertimeMonthClose,
    OvertimeRecord,
    SupervisorPeriod,
    WorkedDay,
)
from apps.novedades.periods import MonthKey, PeriodKey, month_for_date
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    CorrectionService,
    NovedadesError,
    OvertimeMonthService,
    OvertimeService,
    PeriodService,
    WorkedDayService,
)

from .conftest import access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
SEP, OCT, NOV, DEC = MonthKey(2026, 9), MonthKey(2026, 10), MonthKey(2026, 11), MonthKey(2026, 12)
UTC = dt_timezone.utc


def utc(*args):
    return datetime(*args, tzinfo=UTC)


@pytest.fixture
def clock(monkeypatch):
    """Fija el día del negocio y el instante actual."""

    def set_clock(day: date, now: datetime):
        monkeypatch.setattr("apps.novedades.services.today", lambda: day)
        monkeypatch.setattr("apps.novedades.views.today", lambda: day)
        monkeypatch.setattr("django.utils.timezone.now", lambda: now)

    return set_clock


def _collab(sup, cedula="0102030405", name="Ana Pérez"):
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(cedula=cedula, full_name=name, regional="Sierra", cargo="Operador"),
    )


def _ot(sup, collaborator, day, hours="2"):
    return OvertimeService.create(
        access(sup), {"collaborator_id": collaborator.pk, "date": day, "overtime_hours": hours}
    )


def _xlsx(rows) -> SimpleUploadedFile:
    wb = openpyxl.Workbook()
    for row in rows:
        wb.active.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    return SimpleUploadedFile("horas.xlsx", buffer.getvalue())


# ── Cálculo del plazo (48–72 horas laborables) ────────────────────────────────


def test_deadline_counts_only_business_days_from_month_start():
    # 01/11/2026 es domingo: el cómputo arranca el lunes 02/11 a las 00:00 (UTC-5).
    deadline = OvertimeMonthService.deadline(OCT, hours=48, holidays=set())
    assert deadline == utc(2026, 11, 4, 5)  # 04/11 00:00 en Ecuador = 05:00 UTC
    assert OvertimeMonthService.deadline_label(deadline) == "martes 03/11/2026 23:59"
    assert OvertimeMonthService.deadline(OCT, hours=72, holidays=set()) == utc(2026, 11, 5, 5)
    # Horas no múltiplo de 24: termina a mitad del día hábil.
    partial = OvertimeMonthService.deadline(OCT, hours=60, holidays=set())
    assert partial == utc(2026, 11, 4, 17)  # miércoles 04/11 12:00 en Ecuador


def test_deadline_skips_holidays_and_weekends():
    holidays = {date(2026, 11, 2), date(2026, 11, 3)}  # Difuntos e Independencia de Cuenca
    deadline = OvertimeMonthService.deadline(OCT, hours=48, holidays=holidays)
    assert OvertimeMonthService.deadline_label(deadline) == "jueves 05/11/2026 23:59"
    # Septiembre: 01/10/2026 es jueves → jueves y viernes; no cuenta el fin de semana.
    assert OvertimeMonthService.deadline(SEP, hours=48, holidays=set()) == utc(2026, 10, 3, 5)
    assert OvertimeMonthService.deadline(SEP, hours=72, holidays=set()) == utc(2026, 10, 6, 5)


def test_deadline_across_year_change_with_new_year_holiday():
    # 01/01/2027 es viernes y feriado: cuenta desde el lunes 04/01/2027.
    deadline = OvertimeMonthService.deadline(DEC, hours=48, holidays={date(2027, 1, 1)})
    assert OvertimeMonthService.deadline_label(deadline) == "martes 05/01/2027 23:59"


def test_deadline_uses_configured_holidays_table(admin):
    Holiday.objects.create(date=date(2026, 11, 2), name="Difuntos", year=2026)
    assert OvertimeMonthService.deadline(OCT, hours=48) == utc(2026, 11, 5, 5)


def test_grace_hours_setting_range_permissions_and_not_retroactive(
    clock, client_for, admin, supervisor
):
    clock(date(2026, 10, 12), utc(2026, 10, 12, 15))
    assert OvertimeMonthService.grace_hours(OCT) == 48  # valor por defecto
    for bad in (47, 73):
        response = client_for(admin).patch(
            f"{BASE}/overtime/settings/", {"grace_hours": bad}, format="json"
        )
        assert response.status_code == 400
    assert (
        client_for(supervisor)
        .patch(f"{BASE}/overtime/settings/", {"grace_hours": 72}, format="json")
        .status_code
        == 403
    )
    response = client_for(admin).patch(
        f"{BASE}/overtime/settings/", {"grace_hours": 72}, format="json"
    )
    assert response.status_code == 200 and response.json()["grace_hours"] == 72
    # Aplica al plazo de octubre (empieza el 01/11) pero no al de septiembre,
    # que ya empezó el 01/10: el ajuste no es retroactivo.
    assert OvertimeMonthService.grace_hours(OCT) == 72
    assert OvertimeMonthService.grace_hours(SEP) == 48
    assert NovedadEvent.objects.filter(action="overtime_month.grace_changed").count() == 1


# ── Mes calendario y dos meses a la vez ───────────────────────────────────────


def test_record_belongs_to_calendar_month_of_its_date(clock, client_for, admin, supervisor):
    clock(date(2026, 10, 12), utc(2026, 10, 12, 15))
    c = _collab(supervisor)
    record = _ot(admin, c, date(2026, 9, 25))  # antes iba a "octubre" (23 → 22)
    assert month_for_date(record.date) == SEP
    client = client_for(admin)
    sep = client.get(f"{BASE}/overtime/", {"period": "2026-09"}).json()
    oct_ = client.get(f"{BASE}/overtime/", {"period": "2026-10"}).json()
    assert [r["id"] for r in sep["records"]] == [record.pk]
    assert oct_["records"] == []


def test_current_and_previous_month_are_managed_at_the_same_time(clock, supervisor):
    clock(date(2026, 11, 2), utc(2026, 11, 2, 15))  # lunes, dentro del plazo de octubre
    c = _collab(supervisor)
    nov = _ot(supervisor, c, date(2026, 11, 2))
    octr = _ot(supervisor, c, date(2026, 10, 30))
    OvertimeService.update(access(supervisor), octr.pk, {"overtime_hours": "3", "version": 1})
    octr.refresh_from_db()
    assert str(octr.overtime_hours) == "3.00" and nov.pk != octr.pk
    # Captura masiva de cada mes por separado; no se mezclan.
    result = OvertimeService.bulk_save(
        access(supervisor),
        OCT,
        [
            {
                "client_key": "a",
                "collaborator_id": c.pk,
                "date": date(2026, 10, 29),
                "overtime_hours": "1",
            },
            {
                "client_key": "b",
                "collaborator_id": c.pk,
                "date": date(2026, 11, 3),
                "overtime_hours": "1",
            },
        ],
    )
    assert [r["status"] for r in result["rows"]] == ["created", "error"]


def test_future_month_is_rejected(clock, supervisor):
    clock(date(2026, 10, 12), utc(2026, 10, 12, 15))
    c = _collab(supervisor)
    with pytest.raises(NovedadesError) as exc:
        _ot(supervisor, c, date(2026, 11, 3))
    assert exc.value.code == "period_not_open"
    with pytest.raises(NovedadesError):
        OvertimeService.bulk_save(
            access(supervisor),
            NOV,
            [
                {
                    "client_key": "a",
                    "collaborator_id": c.pk,
                    "date": date(2026, 11, 3),
                    "overtime_hours": "1",
                }
            ],
        )


# ── Estados: abierto, plazo, vencido (solo aviso) ─────────────────────────────


def test_states_grace_then_overdue_without_automatic_close(clock, client_for, admin, supervisor):
    c = _collab(supervisor)
    clock(date(2026, 11, 3), utc(2026, 11, 3, 15))  # martes 10:00, plazo hasta 23:59
    months = {m["code"]: m for m in client_for(supervisor).get(f"{BASE}/overtime/months/").json()}
    assert months["2026-11"]["status"] == "OPEN"
    october = months["2026-10"]
    assert october["status"] == "GRACE" and october["closing_soon"] is True
    assert october["deadline_label"] == "martes 03/11/2026 23:59"
    assert october["remaining_seconds"] == 14 * 3600  # hasta 04/11 00:00 (UTC-5)

    # Vence el plazo: NO se cierra solo; sigue editable y se avisa una vez.
    clock(date(2026, 11, 4), utc(2026, 11, 4, 15))
    for _ in range(2):
        months = {
            m["code"]: m for m in client_for(supervisor).get(f"{BASE}/overtime/months/").json()
        }
    assert months["2026-10"]["status"] == "OVERDUE"
    # El mes vencido no se bloquea (no hay cierre automático); la fecha 30/10
    # ya pasó su plazo individual, así que la registra el Administrador.
    record = _ot(admin, c, date(2026, 10, 30))
    assert record.pk is not None
    assert not OvertimeMonthClose.objects.exists()
    warnings = Notification.objects.filter(
        user=admin, dedup_key=f"novedades:overtime-overdue:{supervisor.pk}:2026-10"
    )
    assert warnings.count() == 1


# ── Cierre manual ─────────────────────────────────────────────────────────────


def test_manual_close_is_idempotent_per_team_and_only_for_ended_months(
    clock, client_for, admin, supervisor, supervisor2, assistant
):
    clock(date(2026, 11, 2), utc(2026, 11, 2, 15))
    c = _collab(supervisor)
    c2 = _collab(supervisor2, "0922222222", "Carla")
    _ot(supervisor, c, date(2026, 10, 30))
    client = client_for(supervisor)
    payload = {"period": "2026-10", "confirm": True}
    first = client.post(f"{BASE}/overtime/months/close/", payload, format="json").json()
    again = client.post(f"{BASE}/overtime/months/close/", payload, format="json").json()
    assert first["already_closed"] is False and first["status"] == "CLOSED"
    assert first["summary"]["records"] == 1
    assert again["already_closed"] is True
    assert OvertimeMonthClose.objects.count() == 1
    assert NovedadEvent.objects.filter(action="overtime_month.closed").count() == 1
    # El mes en curso no se cierra.
    current = client.post(
        f"{BASE}/overtime/months/close/", {"period": "2026-11", "confirm": True}, format="json"
    )
    assert current.status_code == 409
    # Sin permiso de cierre / otro equipo.
    assert (
        client_for(assistant)
        .post(
            f"{BASE}/overtime/months/close/",
            {**payload, "supervisor_id": supervisor.pk},
            format="json",
        )
        .status_code
        == 403
    )
    # El otro equipo sigue abierto en octubre.
    _ot(supervisor2, c2, date(2026, 10, 30))
    # El Administrador puede cerrar por el supervisor.
    by_admin = client_for(admin).post(
        f"{BASE}/overtime/months/close/",
        {**payload, "supervisor_id": supervisor2.pk},
        format="json",
    )
    assert by_admin.status_code == 200 and OvertimeMonthClose.objects.count() == 2


def test_closed_month_blocks_every_write_path_but_allows_query_and_export(
    clock, client_for, admin, supervisor
):
    clock(date(2026, 11, 2), utc(2026, 11, 2, 15))
    c = _collab(supervisor)
    c2 = _collab(supervisor, "0102030406", "Beto Ruiz")
    record = _ot(supervisor, c, date(2026, 10, 30))
    OvertimeMonthService.close(access(supervisor), OCT, supervisor)
    acc = access(supervisor)

    with pytest.raises(NovedadesError) as exc:
        _ot(supervisor, c2, date(2026, 10, 29))
    assert exc.value.code == "period_closed"
    with pytest.raises(NovedadesError):
        OvertimeService.update(acc, record.pk, {"overtime_hours": "5", "version": 1})
    with pytest.raises(NovedadesError):
        OvertimeService.delete(acc, record.pk, "x")
    bulk = OvertimeService.bulk_save(
        acc,
        OCT,
        [
            {
                "client_key": "a",
                "collaborator_id": c2.pk,
                "date": date(2026, 10, 29),
                "overtime_hours": "1",
            }
        ],
    )
    assert bulk["rows"][0]["status"] == "locked"

    client = client_for(supervisor)
    # Solicitudes directas a la API: también rechazadas.
    direct = client.post(
        f"{BASE}/overtime/",
        {"collaborator_id": c2.pk, "date": "2026-10-29", "overtime_hours": "1"},
        format="json",
    )
    assert direct.status_code == 409
    assert (
        client.patch(
            f"{BASE}/overtime/{record.pk}/", {"overtime_hours": "9"}, format="json"
        ).status_code
        == 409
    )
    assert client.delete(f"{BASE}/overtime/{record.pk}/", {}, format="json").status_code == 409

    # Importación de octubre: no aplica nada.
    row = [
        date(2026, 10, 28),
        "0102030406",
        "Beto Ruiz",
        "",
        "",
        "",
        2,
        0,
        "NO",
        "NO",
        "NO",
        "x",
        "",
    ]
    preview = (
        client_for(admin)
        .post(
            f"{BASE}/imports/preview/",
            {"kind": "OVERTIME", "period": "2026-10", "file": _xlsx([OVERTIME_HEADERS, row])},
            format="multipart",
        )
        .json()
    )
    confirm = client_for(admin).post(
        f"{BASE}/imports/{preview['id']}/confirm/", {"strategy": "skip"}, format="json"
    )
    assert confirm.status_code == 409

    record.refresh_from_db()
    assert str(record.overtime_hours) == "2.00" and record.deleted_at is None
    assert OvertimeRecord.objects.filter(deleted_at__isnull=True).count() == 1
    # Consulta y exportación siguen disponibles.
    listed = client_for(admin).get(f"{BASE}/overtime/", {"period": "2026-10"}).json()
    assert [r["id"] for r in listed["records"]] == [record.pk]
    assert listed["indicators"]["supervisors_closed"] == 1
    assert (
        client_for(admin).get(f"{BASE}/overtime/export/", {"period": "2026-10"}).status_code == 200
    )


def test_import_to_calendar_month_accepts_late_month_dates(clock, client_for, admin, supervisor):
    clock(date(2026, 11, 2), utc(2026, 11, 2, 15))
    _collab(supervisor)
    row = [
        date(2026, 10, 28),
        "0102030405",
        "Ana Pérez",
        "",
        "",
        "",
        2,
        0,
        "NO",
        "NO",
        "NO",
        "x",
        "",
    ]
    client = client_for(admin)
    preview = client.post(
        f"{BASE}/imports/preview/",
        {"kind": "OVERTIME", "period": "2026-10", "file": _xlsx([OVERTIME_HEADERS, row])},
        format="multipart",
    ).json()
    assert preview["summary"]["valid_rows"] == 1  # 28/10 es de octubre (antes: noviembre)
    client.post(f"{BASE}/imports/{preview['id']}/confirm/", {"strategy": "skip"}, format="json")
    retry = client.post(
        f"{BASE}/imports/{preview['id']}/confirm/", {"strategy": "skip"}, format="json"
    )
    assert retry.status_code == 200
    assert OvertimeRecord.objects.count() == 1  # sin duplicados al reintentar


# ── Corrección autorizada tras el cierre ──────────────────────────────────────


def test_authorized_correction_requires_reason_is_audited_and_does_not_reopen(
    clock, client_for, admin, supervisor
):
    clock(date(2026, 11, 5), utc(2026, 11, 5, 15))
    c = _collab(supervisor)
    record = _ot(admin, c, date(2026, 10, 30))  # plazo por fecha vencido: excepción
    # Sin cierre, la corrección no aplica: se usa la edición ordinaria.
    with pytest.raises(NovedadesError) as exc:
        CorrectionService.correct_overtime(
            access(admin),
            record_id=record.pk,
            changes={"overtime_hours": "3"},
            delete=False,
            reason="x",
        )
    assert exc.value.code == "period_open"
    OvertimeMonthService.close(access(supervisor), OCT, supervisor)

    with pytest.raises(NovedadesError):  # motivo obligatorio
        CorrectionService.correct_overtime(
            access(admin),
            record_id=record.pk,
            changes={"overtime_hours": "3"},
            delete=False,
            reason=" ",
        )
    with pytest.raises(NovedadesError):  # el supervisor no corrige un mes cerrado
        CorrectionService.correct_overtime(
            access(supervisor),
            record_id=record.pk,
            changes={"overtime_hours": "3"},
            delete=False,
            reason="x",
        )
    correction = CorrectionService.correct_overtime(
        access(admin),
        record_id=record.pk,
        changes={"overtime_hours": "3"},
        delete=False,
        reason="Ajuste aprobado por RRHH",
    )
    assert correction.corrected_by == admin and correction.target_id == record.pk
    assert (correction.period.year, correction.period.month) == (2026, 10)
    assert correction.original_values["overtime_hours"] == "2"
    assert correction.new_values["overtime_hours"] == "3"
    assert correction.reason == "Ajuste aprobado por RRHH"
    assert NovedadEvent.objects.filter(
        action="correction.overtime", target_id=str(record.pk)
    ).exists()
    # El mes sigue cerrado: la corrección no lo reabre.
    with pytest.raises(NovedadesError):
        _ot(supervisor, c, date(2026, 10, 29))
    assert ClosedPeriodCorrection.objects.count() == 1


# ── Regresión: Días laborados (23 → 22) intacto e independiente ───────────────


def test_worked_days_cutoff_and_close_are_untouched(clock, supervisor):
    clock(date(2026, 10, 12), utc(2026, 10, 12, 15))
    c = _collab(supervisor)
    key = PeriodKey(2026, 10)
    assert (key.start_date, key.end_date) == (date(2026, 9, 23), date(2026, 10, 22))
    WorkedDayService.save_cells(
        access(supervisor),
        key,
        supervisor,
        [{"collaborator_id": c.pk, "date": date(2026, 10, 12), "hours": "8"}],
    )
    PeriodService.close(access(supervisor), key, supervisor)
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            access(supervisor),
            key,
            supervisor,
            [{"collaborator_id": c.pk, "date": date(2026, 10, 13), "hours": "8"}],
        )
    assert exc.value.code == "period_closed"
    assert WorkedDay.objects.count() == 1
    # Cerrar Días laborados no cierra Horas extras, y viceversa.
    assert not OvertimeMonthClose.objects.exists()
    _ot(supervisor, c, date(2026, 10, 9))  # 13/10 sería futura (hoy es 12/10)
    clock(date(2026, 11, 2), utc(2026, 11, 2, 15))
    OvertimeMonthService.close(access(supervisor), OCT, supervisor)
    assert SupervisorPeriod.objects.get(period__month=11, supervisor=supervisor).status == "OPEN"
