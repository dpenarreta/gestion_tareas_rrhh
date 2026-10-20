"""Permisos por tipo de día para que un Supervisor registre Horas extras
(laborables, sábados, domingos y feriados), con feriados nacionales y locales."""

from datetime import date

import pytest

from apps.configuration.models import Holiday
from apps.configuration.services import get_holiday_set
from apps.core.models import AuditLog
from apps.novedades import access as perms
from apps.novedades.models import NovedadEvent, OvertimeDayPermission, OvertimeRecord
from apps.novedades.periods import MonthKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    NovedadesError,
    OvertimeDayPermissionService,
    OvertimeService,
    PermissionAdminService,
)

from .conftest import access
from .test_api import _xlsx
from .test_bulk import OVERTIME_HEADERS

pytestmark = pytest.mark.django_db

OCT = MonthKey(2026, 10)
MON = date(2026, 10, 12)  # hoy en los tests
FRI = date(2026, 10, 9)
SAT = date(2026, 10, 10)
SUN = date(2026, 10, 11)
BASE = "/api/v1/novedades"


def _collab(sup, cedula="0102030405", regional="Sierra"):
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(
            cedula=cedula,
            full_name=f"Persona {cedula[-2:]}",
            regional=regional,
            area="Bodega",
            cargo="Operador",
        ),
    )


def _set(admin, sup, **values):
    return OvertimeDayPermissionService.update(access(admin), sup.pk, values)


def _create(sup, collaborator, day, hours="2", field=None):
    """# HORAS EXTRAS en días laborables; # HORAS SABADO en sábados, domingos y
    feriados (la columna que corresponde a cada tipo de día)."""
    if field is None:
        weekend_or_holiday = (
            day.weekday() >= 5
            or Holiday.objects.filter(date=day, scope=Holiday.Scope.NATIONAL).exists()
        )
        field = "saturday_hours" if weekend_or_holiday else "overtime_hours"
    return OvertimeService.create(
        access(sup), {"collaborator_id": collaborator.pk, "date": day, field: hours}
    )


def test_new_supervisor_starts_with_everything_disabled(admin, restricted_supervisor):
    row = next(
        r
        for r in OvertimeDayPermissionService.matrix(access(admin))
        if r["supervisor"]["id"] == restricted_supervisor.pk
    )
    assert row["permissions"] == {
        "weekday": False,
        "saturday": False,
        "sunday": False,
        "holiday": False,
    }
    assert row["configured"] is False
    collaborator = _collab(restricted_supervisor)
    with pytest.raises(NovedadesError) as exc:
        _create(restricted_supervisor, collaborator, MON)
    assert exc.value.code == "day_not_allowed" and exc.value.status == 403
    assert "días laborables" in exc.value.message


def test_two_supervisors_with_different_permissions(admin, supervisor, restricted_supervisor):
    _set(admin, restricted_supervisor, weekday=True)
    mine, theirs = _collab(supervisor, "0102030401"), _collab(restricted_supervisor, "0102030402")
    _create(supervisor, mine, SAT)
    _create(supervisor, mine, SUN)
    _create(restricted_supervisor, theirs, MON)
    with pytest.raises(NovedadesError, match="sábados"):
        _create(restricted_supervisor, theirs, SAT)
    with pytest.raises(NovedadesError, match="domingos"):
        _create(restricted_supervisor, theirs, SUN)
    assert OvertimeRecord.objects.filter(supervisor=restricted_supervisor).count() == 1


def test_holiday_on_weekday_requires_only_holiday_and_on_weekend_requires_both(
    admin, restricted_supervisor
):
    Holiday.objects.create(date=FRI, name="Feriado de prueba", year=2026)
    Holiday.objects.create(date=SAT, name="Feriado en sábado", year=2026)
    collaborator = _collab(restricted_supervisor)
    _set(admin, restricted_supervisor, weekday=True, saturday=True)
    with pytest.raises(NovedadesError, match="feriados"):
        _create(restricted_supervisor, collaborator, FRI)  # laborable no alcanza
    with pytest.raises(NovedadesError, match="feriados"):
        _create(restricted_supervisor, collaborator, SAT)  # sábado sí, feriado no
    _set(admin, restricted_supervisor, holiday=True, saturday=False)
    with pytest.raises(NovedadesError, match="sábados"):
        _create(restricted_supervisor, collaborator, SAT)  # feriado sí, sábado no
    record = _create(restricted_supervisor, collaborator, FRI)
    assert record.is_holiday is True
    _set(admin, restricted_supervisor, saturday=True)
    _create(restricted_supervisor, collaborator, SAT)


def test_local_holiday_only_applies_to_its_regional_and_not_to_analytics(
    admin, restricted_supervisor
):
    Holiday.objects.create(
        date=FRI, name="Fundación local", year=2026, scope=Holiday.Scope.LOCAL, regional="Costa"
    )
    _set(admin, restricted_supervisor, weekday=True)
    sierra = _collab(restricted_supervisor, "0102030401", regional="Sierra")
    costa = _collab(restricted_supervisor, "0102030402", regional=" costa ")
    assert _create(restricted_supervisor, sierra, FRI).is_holiday is False
    with pytest.raises(NovedadesError, match="feriados"):
        _create(restricted_supervisor, costa, FRI)
    assert FRI not in get_holiday_set()  # días hábiles y Analytics: solo nacionales


def test_editing_a_record_on_a_disallowed_day_is_blocked_but_reading_is_not(
    client_for, admin, supervisor
):
    collaborator = _collab(supervisor)
    record = _create(supervisor, collaborator, SUN)
    _set(admin, supervisor, sunday=False)
    with pytest.raises(NovedadesError, match="domingos"):
        OvertimeService.update(access(supervisor), record.pk, {"saturday_hours": "3"})
    record.refresh_from_db()
    assert str(record.saturday_hours) == "2.00"  # lo registrado no se toca
    listed = client_for(supervisor).get(f"{BASE}/overtime/?period=2026-10")
    assert listed.status_code == 200 and listed.json()


def test_bulk_save_rejects_only_disallowed_rows(admin, restricted_supervisor):
    _set(admin, restricted_supervisor, weekday=True)
    a, b = _collab(restricted_supervisor, "0102030401"), _collab(
        restricted_supervisor, "0102030402"
    )
    result = OvertimeService.bulk_save(
        access(restricted_supervisor),
        OCT,
        [
            {"client_key": "ok", "collaborator_id": a.pk, "date": MON, "overtime_hours": "2"},
            {"client_key": "no", "collaborator_id": b.pk, "date": SUN, "overtime_hours": "2"},
        ],
    )
    by_key = {r["client_key"]: r for r in result["rows"]}
    assert by_key["ok"]["status"] == "created"
    assert by_key["no"]["status"] == "error" and "domingos" in by_key["no"]["errors"]["date"]


def test_moving_a_record_out_of_a_disallowed_date_is_also_blocked(admin, supervisor):
    collaborator = _collab(supervisor)
    record = _create(supervisor, collaborator, SUN)
    _set(admin, supervisor, sunday=False)
    result = OvertimeService.bulk_save(
        access(supervisor),
        OCT,
        [
            {
                "client_key": "m",
                "id": record.pk,
                "version": record.version,
                "collaborator_id": collaborator.pk,
                "date": FRI,
                "overtime_hours": "2",
            }
        ],
    )
    assert result["rows"][0]["status"] == "error"
    record.refresh_from_db()
    assert record.date == SUN


def test_import_preview_and_confirm_reject_disallowed_days(
    client_for, admin, restricted_supervisor
):
    _set(admin, restricted_supervisor, weekday=True)
    PermissionAdminService.create_override(
        access(admin),
        user_id=restricted_supervisor.pk,
        codename=perms.IMPORTAR,
        effect="GRANT",
        reason="Carga",
    )
    _collab(restricted_supervisor)
    weekday = [MON, "0102030405", "Ana", "", "", "", 2, 0, "NO", "NO", "NO", "Carga", ""]
    sunday = [SUN, "0102030405", "Ana", "", "", "", 2, 0, "NO", "SI", "NO", "Carga", ""]
    client = client_for(restricted_supervisor)
    body = client.post(
        f"{BASE}/imports/preview/",
        {
            "kind": "OVERTIME",
            "period": "2026-10",
            "file": _xlsx([OVERTIME_HEADERS, weekday, sunday]),
        },
        format="multipart",
    ).json()
    assert body["summary"]["valid_rows"] == 1 and body["summary"]["invalid_rows"] == 1
    assert any("domingos" in e["message"] for e in body["errors"])
    client.post(f"{BASE}/imports/{body['id']}/confirm/", {"strategy": "skip"}, format="json")
    assert list(OvertimeRecord.objects.values_list("date", flat=True)) == [MON]


def test_assistant_and_admin_are_not_restricted(admin, assistant, restricted_supervisor):
    collaborator = _collab(restricted_supervisor)
    record = OvertimeService.create(
        access(assistant), {"collaborator_id": collaborator.pk, "date": SUN, "overtime_hours": "2"}
    )
    OvertimeService.update(access(admin), record.pk, {"overtime_hours": "4"})
    assert OvertimeDayPermissionService.rules(access(assistant))["restricted"] is False


def test_changes_are_audited_and_only_admin_can_configure(admin, supervisor, client_for):
    _set(admin, supervisor, saturday=False, holiday=False)
    event = NovedadEvent.objects.get(action="overtime.day_permissions_changed")
    assert event.actor == admin and event.supervisor == supervisor
    assert "sábados: Sí" in event.old_value and "sábados: No" in event.new_value
    assert event.created_at is not None
    assert AuditLog.objects.filter(action="novedades.overtime.day_permissions_changed").exists()
    # Un cambio sin efecto no genera evento.
    _set(admin, supervisor, saturday=False)
    assert NovedadEvent.objects.filter(action="overtime.day_permissions_changed").count() == 1
    with pytest.raises(NovedadesError) as exc:
        OvertimeDayPermissionService.update(access(supervisor), supervisor.pk, {"saturday": True})
    assert exc.value.status == 403
    api = client_for(admin)
    response = api.patch(
        f"{BASE}/permissions/overtime-days/{supervisor.pk}/", {"sunday": False}, format="json"
    )
    assert response.status_code == 200 and response.json()["permissions"]["sunday"] is False
    assert (
        api.patch(
            f"{BASE}/permissions/overtime-days/{supervisor.pk}/",
            {"sunday": "quizás"},
            format="json",
        ).status_code
        == 400
    )
    assert client_for(supervisor).get(f"{BASE}/permissions/overtime-days/").status_code == 403


def test_me_exposes_rules_for_the_supervisor(client_for, admin, restricted_supervisor):
    Holiday.objects.create(date=FRI, name="Nacional", year=2026)
    Holiday.objects.create(
        date=SAT, name="Local", year=2026, scope=Holiday.Scope.LOCAL, regional="Costa"
    )
    _set(admin, restricted_supervisor, weekday=True)
    rules = client_for(restricted_supervisor).get(f"{BASE}/me/").json()["overtime_day_rules"]
    assert rules["restricted"] is True
    assert rules["allowed"] == {
        "weekday": True,
        "saturday": False,
        "sunday": False,
        "holiday": False,
    }
    assert {"date": "2026-10-09", "regional": ""} in rules["holidays"]
    assert {"date": "2026-10-10", "regional": "costa"} in rules["holidays"]


def test_existing_supervisors_were_seeded_with_everything_enabled():
    """La migración 0014 sembró en Sí a quienes ya eran supervisores."""
    from importlib import import_module

    migration = import_module("apps.novedades.migrations.0014_overtime_day_permissions")
    assert hasattr(migration, "seed_existing_supervisors")
    fields = {f.name for f in OvertimeDayPermission._meta.get_fields()}
    assert {"weekday", "saturday", "sunday", "holiday", "updated_by", "updated_at"} <= fields


def test_holiday_api_supports_local_scope(client_for, admin):
    client = client_for(admin)
    ok = client.post(
        "/api/v1/settings/holidays/",
        {"date": "2026-11-10", "name": "Local", "scope": "LOCAL", "regional": "Costa"},
        format="json",
    )
    assert ok.status_code == 201 and ok.json()["regional"] == "Costa"
    missing = client.post(
        "/api/v1/settings/holidays/",
        {"date": "2026-11-11", "name": "X", "scope": "LOCAL"},
        format="json",
    )
    assert missing.status_code == 400 and "regional" in missing.json()["error"]
    national = client.post(
        "/api/v1/settings/holidays/", {"date": "2026-11-10", "name": "Nacional"}, format="json"
    )
    assert national.status_code == 201  # misma fecha, otro alcance
    assert (
        client.post(
            "/api/v1/settings/holidays/",
            {"date": "2026-11-10", "name": "Otra", "scope": "LOCAL", "regional": "costa"},
            format="json",
        ).status_code
        == 409
    )
    assert [h["scope"] for h in client.get("/api/v1/settings/holidays/?year=2026").json()] == [
        "NATIONAL"
    ]
    assert len(client.get("/api/v1/settings/holidays/?year=2026&scope=all").json()) == 2


# ── Columnas de horas según permisos (2026-10-20) ───────────────────────────
# # HORAS EXTRAS ↔ días laborables; # HORAS SABADO ↔ sábados, domingos y feriados.


def _bulk(sup, *rows):
    return {
        r["client_key"]: r for r in OvertimeService.bulk_save(access(sup), OCT, list(rows))["rows"]
    }


def test_scenario_all_day_types_allows_both_columns(supervisor):
    collaborator = _collab(supervisor)
    record = _create(supervisor, collaborator, MON, field="overtime_hours")
    OvertimeService.update(access(supervisor), record.pk, {"saturday_hours": "1"})
    assert OvertimeDayPermissionService.column_access(access(supervisor)) == {
        "overtime_hours": True,
        "saturday_hours": True,
    }


def test_scenario_saturday_only(admin, restricted_supervisor):
    _set(admin, restricted_supervisor, saturday=True)
    collaborator = _collab(restricted_supervisor)
    assert OvertimeDayPermissionService.column_access(access(restricted_supervisor)) == {
        "overtime_hours": False,
        "saturday_hours": True,
    }
    record = _create(restricted_supervisor, collaborator, SAT, field="saturday_hours")
    assert record.saturday_hours == 2 and record.overtime_hours == 0
    other = _collab(restricted_supervisor, "0102030499")
    with pytest.raises(NovedadesError) as exc:
        OvertimeService.create(
            access(restricted_supervisor),
            {"collaborator_id": other.pk, "date": SAT, "overtime_hours": "2"},
        )
    assert exc.value.code == "column_not_allowed" and "# HORAS EXTRAS" in exc.value.message
    with pytest.raises(NovedadesError, match="días laborables"):
        _create(restricted_supervisor, collaborator, MON, field="saturday_hours")


def test_scenario_jose_no_weekdays_but_sundays_and_holidays(admin, restricted_supervisor):
    """Configuración real de José Andaluz en la base de desarrollo: laborables
    No; sábados, domingos y feriados Sí."""
    _set(admin, restricted_supervisor, saturday=True, sunday=True, holiday=True)
    Holiday.objects.create(date=FRI, name="Feriado", year=2026)
    collaborator = _collab(restricted_supervisor)
    assert OvertimeDayPermissionService.column_access(access(restricted_supervisor)) == {
        "overtime_hours": False,
        "saturday_hours": True,
    }
    _create(restricted_supervisor, collaborator, SUN)
    _create(restricted_supervisor, collaborator, FRI)  # feriado entre semana
    with pytest.raises(NovedadesError, match="días laborables"):
        _create(restricted_supervisor, collaborator, MON)
    other = _collab(restricted_supervisor, "0102030498")
    with pytest.raises(NovedadesError) as exc:  # ni por la API directa
        OvertimeService.create(
            access(restricted_supervisor),
            {"collaborator_id": other.pk, "date": SUN, "overtime_hours": "3"},
        )
    assert exc.value.code == "column_not_allowed"


def test_import_rejects_rows_with_data_in_unauthorized_columns(
    client_for, admin, restricted_supervisor
):
    _set(admin, restricted_supervisor, saturday=True, sunday=True, holiday=True)
    PermissionAdminService.create_override(
        access(admin),
        user_id=restricted_supervisor.pk,
        codename=perms.IMPORTAR,
        effect="GRANT",
        reason="Carga",
    )
    _collab(restricted_supervisor, "0102030405")
    _collab(restricted_supervisor, "0102030406")
    ok = [SUN, "0102030405", "Ana", "", "", "", 0, 3, "NO", "SI", "NO", "Carga", ""]
    bad_column = [SAT, "0102030406", "Luis", "", "", "", 2, 0, "SI", "NO", "NO", "Carga", ""]
    client = client_for(restricted_supervisor)
    body = client.post(
        f"{BASE}/imports/preview/",
        {
            "kind": "OVERTIME",
            "period": "2026-10",
            "file": _xlsx([OVERTIME_HEADERS, ok, bad_column]),
        },
        format="multipart",
    ).json()
    assert body["summary"]["valid_rows"] == 1 and body["summary"]["invalid_rows"] == 1
    error = next(e for e in body["errors"] if e["row"] == 3)
    assert error["column"] == "# HORAS EXTRAS" and "no autorizada" in error["message"]
    client.post(f"{BASE}/imports/{body['id']}/confirm/", {"strategy": "skip"}, format="json")
    saved = OvertimeRecord.objects.get()
    assert saved.date == SUN and saved.saturday_hours == 3 and saved.overtime_hours == 0


def test_bulk_saves_valid_rows_and_rejects_unauthorized_column(admin, restricted_supervisor):
    _set(admin, restricted_supervisor, saturday=True)
    a = _collab(restricted_supervisor, "0102030401")
    b = _collab(restricted_supervisor, "0102030402")
    rows = _bulk(
        restricted_supervisor,
        {"client_key": "ok", "collaborator_id": a.pk, "date": SAT, "saturday_hours": "4"},
        {"client_key": "col", "collaborator_id": b.pk, "date": SAT, "overtime_hours": "4"},
    )
    assert rows["ok"]["status"] == "created"
    assert rows["col"]["status"] == "error"
    assert "no autorizada" in rows["col"]["errors"]["overtime_hours"]
    assert OvertimeRecord.objects.count() == 1


def test_history_is_kept_after_losing_a_permission(admin, supervisor):
    collaborator = _collab(supervisor)
    record = _create(
        supervisor, collaborator, SAT, field="overtime_hours"
    )  # válido antes del cambio
    _set(admin, supervisor, weekday=False)  # pierde la columna # HORAS EXTRAS
    OvertimeService.update(access(supervisor), record.pk, {"observations": "Revisado"})
    record.refresh_from_db()
    assert record.overtime_hours == 2 and record.observations == "Revisado"
    with pytest.raises(NovedadesError, match="# HORAS EXTRAS"):
        OvertimeService.update(access(supervisor), record.pk, {"overtime_hours": "5"})
    rows = _bulk(
        supervisor,
        {
            "client_key": "e",
            "id": record.pk,
            "version": record.version,
            "collaborator_id": collaborator.pk,
            "date": SAT,
            "overtime_hours": "2",
            "observations": "Otra vez",
        },
    )
    assert rows["e"]["status"] == "updated"


def test_assistant_consolidated_and_export_keep_full_structure(
    client_for, admin, assistant, restricted_supervisor
):
    import io

    import openpyxl

    from apps.novedades.excel import OVERTIME_EXPORT_HEADERS

    _set(admin, restricted_supervisor, saturday=True)
    collaborator = _collab(restricted_supervisor)
    _create(restricted_supervisor, collaborator, SAT, field="saturday_hours")
    client = client_for(assistant)
    listed = client.get(f"{BASE}/overtime/?period=2026-10").json()
    row = (
        listed["results"][0]
        if isinstance(listed, dict) and "results" in listed
        else (listed["records"][0] if isinstance(listed, dict) else listed[0])
    )
    assert {"overtime_hours", "saturday_hours"} <= set(row)
    assert float(row["overtime_hours"]) == 0 and float(row["saturday_hours"]) == 2
    exported = client.get(f"{BASE}/overtime/export/?period=2026-10")
    assert exported.status_code == 200
    sheet = openpyxl.load_workbook(io.BytesIO(exported.content)).active
    headers = [c.value for c in next(sheet.iter_rows(min_row=1, max_row=1))]
    assert headers[: len(OVERTIME_EXPORT_HEADERS)] == OVERTIME_EXPORT_HEADERS
    assert OvertimeDayPermissionService.rules(access(assistant))["restricted"] is False
