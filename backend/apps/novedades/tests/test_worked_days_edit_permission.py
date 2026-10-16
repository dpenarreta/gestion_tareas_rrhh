"""Permiso «Editar celdas de Días laborados» (pedido del 2026-10-16).

Decisión del usuario: quien lo tiene corrige celdas vacías y con valor de su
PROPIO alcance aunque haya vencido el plazo por fecha. No da `registrar`,
otros equipos, períodos cerrados, fines de semana ni fechas futuras, y no
cambia Horas extras. El Asistente conserva lo que ya tenía por su rol. Se
concede o revoca por persona (excepción individual) o por rol, en Ajustes."""

from datetime import date
from decimal import Decimal

import pytest

from apps.core.models import AuditLog
from apps.novedades import access as perms
from apps.novedades.models import NovedadEvent, PermissionOverride, SupervisorPeriod, WorkedDay
from apps.novedades.periods import PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    NovedadesError,
    OvertimeService,
    PeriodService,
    PermissionAdminService,
    RecordDeadlineService,
    WorkedDayService,
)

from .conftest import _user, access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
OCT = PeriodKey(2026, 10)  # hoy lunes 12/10/2026
TUE, WED = date(2026, 10, 6), date(2026, 10, 7)  # plazo vencido (48 h hábiles)
SAT, FUTURE = date(2026, 10, 10), date(2026, 10, 13)


def _collab(sup, cedula="0102030405", name="Ana Pérez"):
    PeriodService.ensure_current(sup)
    return CollaboratorService.create(access(sup), CollaboratorInput(cedula=cedula, full_name=name))


def _cell(c, sup, day, hours):
    return WorkedDay.objects.create(
        collaborator=c,
        period=PeriodService.get_period(OCT),
        supervisor=sup,
        date=day,
        hours=None if hours is None else Decimal(hours),
        updated_by=sup,
    )


def _grant(admin, user, reason="Corrige su equipo"):
    return PermissionAdminService.create_override(
        access(admin), user_id=user.pk, codename=perms.DIAS_EDITAR, effect="GRANT", reason=reason
    )


def _save(user, sup, c, day, hours, version=None):
    cell = {"collaborator_id": c.pk, "date": day, "hours": hours}
    if version is not None:
        cell["version"] = version
    return WorkedDayService.save_cells(access(user), OCT, sup, [cell])


def _codes(exc):
    return {e.get("code") for e in exc.value.details["cells"]}


@pytest.fixture
def ana(supervisor):
    c = _collab(supervisor)
    _cell(c, supervisor, WED, "8")  # celda con valor, ya fuera de plazo
    return c


def test_without_permission_current_restrictions_stay(supervisor, ana):
    with pytest.raises(NovedadesError) as exc:
        _save(supervisor, supervisor, ana, WED, "7", version=1)
    assert _codes(exc) == {"deadline_passed"}
    with pytest.raises(NovedadesError):
        _save(supervisor, supervisor, ana, TUE, "8")  # vacía fuera de plazo
    assert WorkedDay.objects.get(collaborator=ana, date=WED).hours == Decimal("8")


def test_with_permission_edits_filled_and_empty_cells_late(admin, supervisor, ana):
    _grant(admin, supervisor)
    _save(supervisor, supervisor, ana, WED, "7", version=1)  # 8 → 7
    _save(supervisor, supervisor, ana, TUE, "6")  # vacía → 6
    cells = dict(WorkedDay.objects.filter(collaborator=ana).values_list("date", "hours"))
    assert cells == {WED: Decimal("7"), TUE: Decimal("6")}
    # Trazabilidad: valor anterior → nuevo, quién y por qué (fuera de plazo).
    event = NovedadEvent.objects.get(field=WED.isoformat())
    assert event.actor == supervisor
    assert event.old_value.startswith("8") and event.new_value.startswith("7")
    assert event.reason == RecordDeadlineService.LATE_REASON_PERMISSION


def test_the_grid_and_rules_reflect_the_permission(admin, supervisor, ana):
    def state(day):
        matrix = WorkedDayService.matrix(access(supervisor), OCT, supervisor)
        return next(c for c in matrix["columns"] if c["date"] == day.isoformat())["deadline_state"]

    assert state(WED) == "expired"
    _grant(admin, supervisor)
    assert state(WED) == "late"  # editable, marcada como fuera de plazo
    rules = RecordDeadlineService.rules(access(supervisor))
    assert rules["worked_days"]["can_bypass"] is True
    assert rules["overtime"]["can_bypass"] is False  # solo Días laborados


def test_restrictions_that_the_permission_never_lifts(admin, supervisor, supervisor2, ana):
    _grant(admin, supervisor)
    with pytest.raises(NovedadesError) as exc:
        _save(supervisor, supervisor, ana, SAT, "8")
    assert _codes(exc) == {"weekend_locked"}
    with pytest.raises(NovedadesError) as exc:
        _save(supervisor, supervisor, ana, FUTURE, "8")
    assert _codes(exc) == {"future_date"}
    # Otro equipo: ni con el permiso.
    other = _collab(supervisor2, "0102030499", "Beto Otro")
    with pytest.raises(NovedadesError) as exc:
        _save(supervisor, supervisor2, other, WED, "8")
    assert exc.value.status == 403
    # Período cerrado: tampoco.
    sp = PeriodService.supervisor_period(OCT, supervisor)
    SupervisorPeriod.objects.filter(pk=sp.pk).update(status=SupervisorPeriod.Status.CLOSED)
    with pytest.raises(NovedadesError) as exc:
        _save(supervisor, supervisor, ana, WED, "6", version=1)
    assert exc.value.code == "period_closed"
    # Horas extras no cambian: sigue vencido para el Supervisor.
    with pytest.raises(NovedadesError) as exc:
        OvertimeService.create(
            access(supervisor),
            {"collaborator_id": ana.pk, "date": WED, "overtime_hours": "2", "work_done": "x"},
        )
    assert exc.value.code == "deadline_passed"
    # Ningún privilegio administrativo.
    acc = access(supervisor)
    assert not acc.national_write and not acc.can(perms.ADMINISTRAR) and not acc.can_bypass_deadline


def test_permission_requires_registrar(admin, supervisor, ana):
    _grant(admin, supervisor)
    PermissionAdminService.create_override(
        access(admin),
        user_id=supervisor.pk,
        codename=perms.REGISTRAR,
        effect="DENY",
        reason="Pausa",
    )
    with pytest.raises(NovedadesError) as exc:
        _save(supervisor, supervisor, ana, WED, "7", version=1)
    assert exc.value.status == 403


def test_direct_api_without_permission_is_rejected(client_for, supervisor, ana):
    response = client_for(supervisor).post(
        f"{BASE}/worked-days/save/",
        {
            "period": OCT.code,
            "supervisor": supervisor.pk,
            "cells": [
                {"collaborator_id": ana.pk, "date": WED.isoformat(), "hours": "7", "version": 1}
            ],
        },
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["error"]["details"]["cells"][0]["code"] == "deadline_passed"
    assert WorkedDay.objects.get(collaborator=ana, date=WED).hours == Decimal("8")


def test_admin_grants_and_revokes_with_audit(client_for, admin, supervisor, ana):
    a = client_for(admin)
    created = a.post(
        f"{BASE}/permissions/overrides/",
        {
            "user_id": supervisor.pk,
            "codename": perms.DIAS_EDITAR,
            "effect": "GRANT",
            "reason": "Cierre de mes",
        },
        format="json",
    )
    assert created.status_code == 201, created.json()
    assert access(supervisor).can(perms.DIAS_EDITAR)
    _save(supervisor, supervisor, ana, WED, "7", version=1)

    override = PermissionOverride.objects.get(codename=perms.DIAS_EDITAR)
    revoked = a.post(
        f"{BASE}/permissions/overrides/{override.pk}/revoke/", {"reason": "Listo"}, format="json"
    )
    assert revoked.status_code == 200
    assert not access(supervisor).can(perms.DIAS_EDITAR)  # persiste en la base, sin relogin
    with pytest.raises(NovedadesError):
        _save(supervisor, supervisor, ana, WED, "6", version=2)
    actions = list(
        NovedadEvent.objects.filter(action__startswith="permission.override")
        .order_by("id")
        .values_list("action", "actor")
    )
    assert actions == [
        ("permission.override_created", admin.pk),
        ("permission.override_revoked", admin.pk),
    ]
    assert AuditLog.objects.filter(actor=admin).exists()


def test_only_admin_grants_and_never_to_the_jefe(client_for, admin, supervisor, assistant):
    # Un Supervisor no puede concedérselo (ni a sí mismo ni a otros).
    for target in (supervisor, assistant):
        r = client_for(supervisor).post(
            f"{BASE}/permissions/overrides/",
            {"user_id": target.pk, "codename": perms.DIAS_EDITAR, "effect": "GRANT", "reason": "x"},
            format="json",
        )
        assert r.status_code == 403
    jefe = _user("jefe", "JEFE_OPERACIONES")
    with pytest.raises(NovedadesError):
        _grant(admin, jefe)  # no disponible para el Jefe de Operaciones
    # El Asistente puede recibirlo; ya corregía fuera de plazo por su rol.
    _grant(admin, assistant)
    assert access(assistant).can(perms.DIAS_EDITAR) and access(assistant).can_bypass_deadline


def test_assistant_keeps_role_behavior_without_the_permission(assistant, supervisor, ana):
    _save(assistant, supervisor, ana, WED, "7", version=1)
    assert WorkedDay.objects.get(collaborator=ana, date=WED).hours == Decimal("7")
    assert not access(assistant).can(perms.DIAS_EDITAR)
