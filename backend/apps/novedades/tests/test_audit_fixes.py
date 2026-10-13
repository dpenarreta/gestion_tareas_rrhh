"""Regresiones de la auditoría integral del 2026-10-13 (ver docs/AUDIT_LOG.md).
Cada test reproduce un defecto confirmado y verifica su corrección."""

import io
from datetime import date, datetime
from datetime import timezone as dt_timezone

import openpyxl
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.notifications.models import Notification
from apps.novedades.excel import OVERTIME_HEADERS, ImportService
from apps.novedades.models import (
    Collaborator,
    ImportBatch,
    NovedadEvent,
    OvertimeMonthClose,
    OvertimeRecord,
    SupervisorPeriod,
    WorkedDay,
)
from apps.novedades.periods import MonthKey, PeriodKey
from apps.novedades.serializers import CloseSerializer
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    NotificationService,
    NovedadesError,
    OvertimeMonthService,
    OvertimeService,
    PeriodService,
    WorkedDayService,
)

from .conftest import _user, access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
OCT = PeriodKey(2026, 10)
SEP_M, OCT_M = MonthKey(2026, 9), MonthKey(2026, 10)
MON = date(2026, 10, 12)
UTC = dt_timezone.utc


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


def _xlsx(rows):
    wb = openpyxl.Workbook()
    for row in rows:
        wb.active.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    return SimpleUploadedFile("horas.xlsx", buffer.getvalue())


# H-01 ── el cierre exige confirm=true (regresión de v1.172.0) ─────────────────


def test_close_requires_explicit_confirmation(client_for, supervisor):
    assert not CloseSerializer(data={"period": "2026-10", "confirm": False}).is_valid()
    _collab(supervisor)
    client = client_for(supervisor)
    for url in ("periods/close/", "overtime/months/close/"):
        response = client.post(
            f"{BASE}/{url}", {"period": "2026-09", "confirm": False}, format="json"
        )
        assert response.status_code == 400, url
    assert not SupervisorPeriod.objects.filter(status="CLOSED").exists()
    assert not OvertimeMonthClose.objects.exists()


# H-02 ── colaborador reasignado: las celdas del equipo anterior no se tocan ──


def test_new_team_cannot_overwrite_previous_team_cells(admin, supervisor, supervisor2):
    c = _collab(supervisor)
    WorkedDayService.save_cells(
        access(supervisor), OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "8"}]
    )
    PeriodService.close(access(supervisor), OCT, supervisor)  # el equipo A cerró octubre
    CollaboratorService.reassign(access(admin), c.pk, supervisor2.pk, "Cambio de equipo")
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            access(supervisor2),
            OCT,
            supervisor2,
            [{"collaborator_id": c.pk, "date": MON, "hours": "4"}],
        )
    assert exc.value.details["cells"][0]["code"] == "other_team"
    assert WorkedDay.objects.get().hours == 8  # intacta
    # La matriz del equipo nuevo la muestra como de otro equipo y no la suma.
    matrix = WorkedDayService.matrix(access(supervisor2), OCT, supervisor2)
    row = next(r for r in matrix["rows"] if r["collaborator_id"] == c.pk)
    assert row["cells"][MON.isoformat()]["other_team"] == "Sup1"
    assert row["total_hours"] == "0"


# H-03 ── cierre y guardado concurrentes ──────────────────────────────────────


def test_save_cells_rechecks_period_inside_the_transaction(supervisor, monkeypatch):
    c = _collab(supervisor)
    acc = access(supervisor)
    real = PeriodService.supervisor_period

    def closes_meanwhile(key, sup):
        # Simula que el período se cerró justo después de la validación inicial.
        sp = real(key, sup)
        SupervisorPeriod.objects.filter(pk=sp.pk).update(status="CLOSED")
        sp.status = "OPEN"
        return sp

    monkeypatch.setattr(PeriodService, "supervisor_period", staticmethod(closes_meanwhile))
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "8"}]
        )
    assert exc.value.code == "period_closed"
    assert not WorkedDay.objects.exists()


def test_overtime_write_rechecks_month_close_under_lock(clock, supervisor, monkeypatch):
    clock(date(2026, 10, 12), datetime(2026, 10, 12, 15, tzinfo=UTC))
    c = _collab(supervisor)
    # Simula el cierre del mes entre la validación y la escritura.
    monkeypatch.setattr(
        OvertimeMonthService, "assert_writable", staticmethod(lambda sup, day: SEP_M)
    )
    OvertimeMonthClose.objects.create(
        supervisor=supervisor, year=2026, month=9, closed_by=supervisor
    )
    with pytest.raises(NovedadesError) as exc:
        OvertimeService.create(
            access(supervisor),
            {"collaborator_id": c.pk, "date": date(2026, 9, 15), "overtime_hours": "2"},
        )
    assert exc.value.code == "period_closed"
    assert not OvertimeRecord.objects.exists()


# H-04 ── celda vacía al cargar y llenada por otro: conflicto, no se pisa ─────


def test_cell_empty_at_load_filled_by_other_user_is_a_conflict(supervisor):
    c = _collab(supervisor)
    acc = access(supervisor)
    WorkedDayService.save_cells(
        acc, OCT, supervisor, [{"collaborator_id": c.pk, "date": MON, "hours": "8"}]
    )
    with pytest.raises(NovedadesError) as exc:
        WorkedDayService.save_cells(
            acc,
            OCT,
            supervisor,
            [{"collaborator_id": c.pk, "date": MON, "hours": "4", "version": None}],
        )
    assert exc.value.code == "conflict"
    assert WorkedDay.objects.get().hours == 8


# H-05 ── duplicados y unicidad: errores claros, no 500 ───────────────────────


def test_repeated_cell_in_payload_is_rejected(supervisor):
    c = _collab(supervisor)
    with pytest.raises(NovedadesError):
        WorkedDayService.save_cells(
            access(supervisor),
            OCT,
            supervisor,
            [
                {"collaborator_id": c.pk, "date": MON, "hours": "8"},
                {"collaborator_id": c.pk, "date": MON, "hours": "4"},
            ],
        )
    assert not WorkedDay.objects.exists()


def test_concurrent_duplicate_cedula_returns_409(supervisor, monkeypatch):
    _collab(supervisor)
    # La validación previa "no ve" la cédula (otra solicitud la creó en paralelo).
    real_filter = Collaborator.objects.filter

    def blind(*args, **kwargs):
        if kwargs.get("cedula") == "0102030405":
            return Collaborator.objects.none()
        return real_filter(*args, **kwargs)

    monkeypatch.setattr(Collaborator.objects, "filter", blind)
    with pytest.raises(NovedadesError) as exc:
        _collab(supervisor)
    assert exc.value.status == 409 and exc.value.code == "duplicate"


# H-06 / H-08 ── resumen del cierre 23 → 22 sin Horas extras; pendientes reales


def test_worked_days_close_summary_has_no_overtime_and_counts_only_members(
    admin, supervisor, supervisor2
):
    c = _collab(supervisor)
    moved = _collab(supervisor, "0102030406", "Beto Ruiz")
    WorkedDayService.save_cells(
        access(supervisor),
        OCT,
        supervisor,
        [{"collaborator_id": moved.pk, "date": MON, "hours": "8"}],
    )
    CollaboratorService.reassign(access(admin), moved.pk, supervisor2.pk, "Cambio")
    summary = PeriodService.close_summary(access(supervisor), OCT, supervisor)
    assert "overtime_records" not in summary and "overtime_hours" not in summary
    workdays = sum(1 for d in OCT.dates() if d.weekday() < 5)
    assert summary["pending_cells"] == workdays  # solo Ana (miembro actual)
    assert c.pk  # Ana sigue en el equipo


# H-07 ── editar datos no revierte un cambio de estado concurrente ────────────


def test_update_does_not_revert_concurrent_status_change(supervisor, monkeypatch):
    c = _collab(supervisor)
    stale = Collaborator.objects.get(pk=c.pk)  # leído antes del cambio de estado
    CollaboratorService.change_status(access(supervisor), c.pk, "INACTIVE", "Renuncia")
    monkeypatch.setattr(CollaboratorService, "_get_for_write", staticmethod(lambda a, i: stale))
    CollaboratorService.update(access(supervisor), c.pk, {"cargo": "Jefe"})
    c.refresh_from_db()
    assert c.status == "INACTIVE" and c.cargo == "Jefe"


# H-10 ── un fallo al notificar no rompe una operación ya guardada ────────────


def test_notification_failure_does_not_break_the_operation(supervisor, monkeypatch):
    def boom():
        raise RuntimeError("SQL caído")

    monkeypatch.setattr(NotificationService, "admin_recipients", staticmethod(boom))
    c = _collab(supervisor)  # notifica al Administrador al crear
    CollaboratorService.change_status(access(supervisor), c.pk, "INACTIVE", "Sale")
    c.refresh_from_db()
    assert c.status == "INACTIVE"


# H-11 ── "próximo a vencer" en horas laborables y momento de refresco ───────


def test_closing_soon_counts_business_hours_and_refresh_time(clock):
    # Plazo de 60 h para septiembre: 01/10 jue + 02/10 vie + 12 h del lun 05/10.
    clock(date(2026, 10, 4), datetime(2026, 10, 4, 17, tzinfo=UTC))  # domingo 12:00 Ecuador
    item = OvertimeMonthService.status(SEP_M, None, holidays=set())
    deadline = OvertimeMonthService.deadline(SEP_M, hours=48, holidays=set())
    assert item["status"] == "OVERDUE" or item["deadline"] == deadline  # 48 h por defecto
    hours60 = OvertimeMonthService.deadline(SEP_M, hours=60, holidays=set())
    assert hours60 == datetime(2026, 10, 5, 17, tzinfo=UTC)
    secs = OvertimeMonthService.business_seconds_between(
        datetime(2026, 10, 4, 17, tzinfo=UTC), hours60, set()
    )
    assert secs == 12 * 3600  # el domingo no cuenta
    # Mes en curso: refresca al terminar el mes (00:00 del 01/11 en Ecuador).
    clock(date(2026, 10, 12), datetime(2026, 10, 12, 15, tzinfo=UTC))
    current = OvertimeMonthService.status(OCT_M, None, holidays=set())
    assert current["refresh_in_seconds"] == int(
        (
            datetime(2026, 11, 1, 5, tzinfo=UTC) - datetime(2026, 10, 12, 15, tzinfo=UTC)
        ).total_seconds()
    )


# H-12 ── aviso de vencido también desde la vista nacional; solo activos ─────


def test_overdue_warning_from_national_view_and_active_supervisors_only(
    clock, client_for, admin, supervisor, supervisor2
):
    clock(date(2026, 11, 10), datetime(2026, 11, 10, 15, tzinfo=UTC))
    OvertimeMonthClose.objects.create(supervisor=supervisor, year=2026, month=10, closed_by=admin)
    supervisor2.status = "disabled"  # `User.save` deriva `is_active` del estado
    supervisor2.save()
    OvertimeMonthClose.objects.create(supervisor=supervisor2, year=2026, month=10, closed_by=admin)
    other = _user("sup3", "SUPERVISOR_OPERACIONES")
    months = {m["code"]: m for m in client_for(admin).get(f"{BASE}/overtime/months/").json()}
    october = months["2026-10"]
    assert october["supervisors_total"] == 2  # Sup1 y Sup3 (Sup2 inactivo)
    assert october["supervisors_closed"] == 1
    assert october["status"] == "OVERDUE"
    warned = Notification.objects.filter(dedup_key__startswith="novedades:overtime-overdue:")
    assert set(warned.values_list("dedup_key", flat=True)) == {
        f"novedades:overtime-overdue:{other.pk}:2026-10"
    }


# H-13 ── la matriz informa si se puede cerrar aunque no se pueda registrar ──


def test_matrix_reports_closable(supervisor):
    _collab(supervisor)
    matrix = WorkedDayService.matrix(access(supervisor), OCT, supervisor)
    assert matrix["closable"] is True


# H-14 / H-15 ── importación: confirmación única y "omitir" contra la base actual


def test_import_confirm_is_claimed_once_and_skip_respects_current_data(
    clock, client_for, admin, supervisor
):
    clock(date(2026, 10, 12), datetime(2026, 10, 12, 15, tzinfo=UTC))
    c = _collab(supervisor)
    row = [
        date(2026, 10, 5),
        "0102030405",
        "Ana Pérez",
        "",
        "",
        "",
        3,
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
    # Otro usuario registra el mismo día DESPUÉS de la vista previa.
    OvertimeService.create(
        access(supervisor),
        {"collaborator_id": c.pk, "date": date(2026, 10, 5), "overtime_hours": "1"},
    )
    # Mientras otra solicitud está confirmando, la segunda recibe 409.
    assert ImportService._claim(preview["id"]) is True
    busy = client.post(
        f"{BASE}/imports/{preview['id']}/confirm/", {"strategy": "skip"}, format="json"
    )
    assert busy.status_code == 409
    ImportService._release(preview["id"])
    done = client.post(
        f"{BASE}/imports/{preview['id']}/confirm/", {"strategy": "skip"}, format="json"
    )
    assert done.status_code == 200
    assert str(OvertimeRecord.objects.get().overtime_hours) == "1.00"  # no se sobrescribió
    assert ImportBatch.objects.get(pk=preview["id"]).summary["skipped"] == 1
    assert "confirming_since" not in ImportBatch.objects.get(pk=preview["id"]).summary


# H-16 ── PATCH no reinicia marcas manuales que no se enviaron ───────────────


def test_patch_keeps_manual_flags_not_sent(clock, client_for, supervisor):
    clock(date(2026, 10, 12), datetime(2026, 10, 12, 15, tzinfo=UTC))
    c = _collab(supervisor)
    record = OvertimeService.create(
        access(supervisor),
        {"collaborator_id": c.pk, "date": MON, "overtime_hours": "2", "is_holiday": True},
    )
    response = client_for(supervisor).patch(
        f"{BASE}/overtime/{record.pk}/", {"overtime_hours": "3"}, format="json"
    )
    assert response.status_code == 200
    record.refresh_from_db()
    assert record.is_holiday is True and str(record.overtime_hours) == "3.00"


# H-17 ── historial Desde/Hasta en hora de Ecuador ────────────────────────────


def test_history_date_filters_use_local_day(client_for, admin, supervisor):
    c = _collab(supervisor)
    event = NovedadEvent.objects.filter(target_id=str(c.pk)).first()
    # 13/10 01:00 UTC = 12/10 20:00 en Ecuador.
    NovedadEvent.objects.filter(pk=event.pk).update(
        created_at=datetime(2026, 10, 13, 1, tzinfo=UTC)
    )
    client = client_for(admin)
    on_12 = client.get(
        f"{BASE}/history/", {"date_from": "2026-10-12", "date_to": "2026-10-12"}
    ).json()
    on_13 = client.get(
        f"{BASE}/history/", {"date_from": "2026-10-13", "date_to": "2026-10-13"}
    ).json()
    assert event.pk in [e["id"] for e in on_12["results"]]
    assert event.pk not in [e["id"] for e in on_13["results"]]


# H-18 ── parámetros mal formados: 400 con mensaje, no 500 ────────────────────


def test_malformed_filters_return_400(client_for, admin):
    client = client_for(admin)
    assert client.get(f"{BASE}/overtime/", {"supervisor": "abc"}).status_code == 400
    assert client.get(f"{BASE}/overtime/", {"date": "12/10/2026"}).status_code == 400
    assert client.get(f"{BASE}/history/", {"date_from": "ayer"}).status_code == 400
    assert client.get(f"{BASE}/collaborators/", {"supervisor": "x"}).status_code == 400


# H-19 ── misma regla de cédula (9 dígitos -> 10) en la importación de novedades


def test_overtime_import_pads_numeric_cedula(clock, client_for, admin, supervisor):
    clock(date(2026, 10, 12), datetime(2026, 10, 12, 15, tzinfo=UTC))
    _collab(supervisor, "0912345678", "Carla Mora")
    row = [date(2026, 10, 5), 912345678, "Carla Mora", "", "", "", 2, 0, "NO", "NO", "NO", "x", ""]
    preview = (
        client_for(admin)
        .post(
            f"{BASE}/imports/preview/",
            {"kind": "OVERTIME", "period": "2026-10", "file": _xlsx([OVERTIME_HEADERS, row])},
            format="multipart",
        )
        .json()
    )
    assert preview["summary"]["valid_rows"] == 1, preview["errors"]


def test_overtime_import_preview_warns_closed_month(clock, client_for, admin, supervisor):
    clock(date(2026, 11, 2), datetime(2026, 11, 2, 15, tzinfo=UTC))
    _collab(supervisor)
    OvertimeMonthClose.objects.create(supervisor=supervisor, year=2026, month=10, closed_by=admin)
    row = [
        date(2026, 10, 5),
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
    preview = (
        client_for(admin)
        .post(
            f"{BASE}/imports/preview/",
            {"kind": "OVERTIME", "period": "2026-10", "file": _xlsx([OVERTIME_HEADERS, row])},
            format="multipart",
        )
        .json()
    )
    assert any("cerrado" in w["message"] for w in preview["summary"]["warnings"])


# Revisión previa al cierre (sección 4) ─────────────────────────────────────


def test_pre_close_check_reports_without_changing_data(clock, client_for, admin, supervisor):
    clock(date(2026, 11, 2), datetime(2026, 11, 2, 15, tzinfo=UTC))
    c = _collab(supervisor)
    record = OvertimeService.create(
        access(supervisor),
        {"collaborator_id": c.pk, "date": date(2026, 10, 5), "overtime_hours": "2"},
    )
    # Dato inválido que no pudo entrar por la validación normal (p. ej. histórico).
    OvertimeRecord.objects.filter(pk=record.pk).update(overtime_hours=0, saturday_hours=0)
    row = [
        date(2026, 10, 6),
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
    client_for(admin).post(
        f"{BASE}/imports/preview/",
        {"kind": "OVERTIME", "period": "2026-10", "file": _xlsx([OVERTIME_HEADERS, row])},
        format="multipart",
    )
    check = (
        client_for(supervisor).get(f"{BASE}/overtime/months/check/", {"period": "2026-10"}).json()
    )
    assert check["records"] == 1 and check["errors"] == 1 and check["warnings"] == 1
    assert check["issues"][0]["record_id"] == record.pk
    assert len(check["pending_imports"]) == 1
    # Solo informa: el registro sigue igual y el mes sigue abierto.
    assert OvertimeRecord.objects.filter(pk=record.pk, overtime_hours=0).exists()
    assert not OvertimeMonthClose.objects.exists()


# Reintento de una edición ya aplicada (respuesta perdida) ───────────────────


def test_bulk_retry_of_applied_update_is_unchanged_not_conflict(clock, supervisor):
    clock(date(2026, 10, 12), datetime(2026, 10, 12, 15, tzinfo=UTC))
    c = _collab(supervisor)
    record = OvertimeService.create(
        access(supervisor), {"collaborator_id": c.pk, "date": MON, "overtime_hours": "2"}
    )
    row = {
        "client_key": "a",
        "id": record.pk,
        "version": 1,
        "collaborator_id": c.pk,
        "date": MON,
        "overtime_hours": "5",
    }
    first = OvertimeService.bulk_save(access(supervisor), OCT_M, [row])
    retry = OvertimeService.bulk_save(access(supervisor), OCT_M, [row])
    assert first["rows"][0]["status"] == "updated"
    assert retry["rows"][0]["status"] == "unchanged"
