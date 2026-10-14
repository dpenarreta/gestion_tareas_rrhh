"""Ingresos y Salidas: consulta consolidada con permisos individuales
(pedido del 2026-10-14).

- Ingresos = altas en la base (`Collaborator`) + reingresos (Inactivo →
  Activo); Salidas = cambios a Inactivo. Solo lectura: nada aquí crea
  movimientos ni notificaciones.
- `novedades.ingresos_ver` y `novedades.salidas_ver` se conceden por usuario,
  de forma independiente y sin tocar el rol. El Administrador los tiene
  siempre."""

import io
from datetime import timedelta

import openpyxl
import pytest
from django.contrib.auth.models import Permission
from django.core import mail

from apps.core.models import AuditLog
from apps.novedades.excel import MOVEMENT_EXPORT_HEADERS
from apps.novedades.models import (
    Collaborator,
    CollaboratorAssignment,
    CollaboratorExitNotification,
    CollaboratorStatusChange,
    ExitNotificationRecipient,
    NovedadEvent,
)
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    MovementPermissionService,
    MovementService,
    NovedadesError,
    PeriodService,
)
from apps.users.models import User

from .conftest import NOW, _user, access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
ENTRIES, EXITS = "novedades.ingresos_ver", "novedades.salidas_ver"


@pytest.fixture
def analyst(db):
    return _user("analista", "ANALISTA_CC")


@pytest.fixture
def hr(db):
    return _user("talento", "ASISTENTE_GH")


def _collab(sup, cedula, name, cargo="Operador"):
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(cedula=cedula, full_name=name, regional="Sierra", cargo=cargo),
    )


def _grant(admin, user, **tabs):
    return MovementPermissionService.update(User.objects.get(pk=admin.pk), user.pk, tabs)


@pytest.fixture
def history(admin, supervisor, supervisor2):
    """Ana: alta → salida → reingreso → salida (2 salidas, 1 persona).
    Beto: alta y salida mientras era de sup1, luego reasignado a sup2.
    Caro: alta en sup2, sigue activa."""
    PeriodService.ensure_current(supervisor)
    PeriodService.ensure_current(supervisor2)
    ana = _collab(supervisor, "0102030405", "Ana Pérez")
    beto = _collab(supervisor, "0102030406", "Beto Ríos", "Bodeguero")
    caro = _collab(supervisor2, "0102030407", "Caro Vega", "Bodeguero")
    for status in ("INACTIVE", "ACTIVE", "INACTIVE"):
        CollaboratorService.change_status(access(supervisor), ana.pk, status, "Motivo")
    CollaboratorService.change_status(access(supervisor), beto.pk, "INACTIVE", "Renuncia")
    # Fechas distintas para probar el rango (el reloj de los tests está fijo).
    CollaboratorAssignment.objects.update(started_at=NOW - timedelta(days=30))
    Collaborator.objects.filter(pk=beto.pk).update(created_at=NOW - timedelta(days=20))
    CollaboratorStatusChange.objects.filter(collaborator=beto).update(
        created_at=NOW - timedelta(days=10)
    )
    CollaboratorService.reassign(access(admin), beto.pk, supervisor2.pk, "Cambio de zona")
    return ana, beto, caro


# ── 1–5: acceso por pestaña, independiente ────────────────────────────────────


def test_admin_sees_both_tabs(client_for, admin, history):
    c = client_for(admin)
    assert c.get(f"{BASE}/movements/access/").json() == {
        "entries": True,
        "exits": True,
        "can_manage": True,
    }
    assert c.get(f"{BASE}/movements/entries/").status_code == 200
    assert c.get(f"{BASE}/movements/exits/").status_code == 200


def test_entries_permission_does_not_open_exits(client_for, admin, analyst, history):
    _grant(admin, analyst, entries=True)
    c = client_for(analyst)
    assert c.get(f"{BASE}/movements/access/").json()["entries"] is True
    assert c.get(f"{BASE}/movements/entries/").status_code == 200
    assert c.get(f"{BASE}/movements/entries/export/").status_code == 200
    for path in ("exits/", "exits/export/"):
        assert c.get(f"{BASE}/movements/{path}").status_code == 403


def test_exits_permission_does_not_open_entries(client_for, admin, analyst, history):
    _grant(admin, analyst, exits=True)
    c = client_for(analyst)
    assert c.get(f"{BASE}/movements/exits/").status_code == 200
    for path in ("entries/", "entries/export/"):
        assert c.get(f"{BASE}/movements/{path}").status_code == 403


@pytest.mark.parametrize("who", ["analyst", "hr", "supervisor", "assistant"])
def test_without_permission_every_endpoint_is_denied(client_for, request, history, who):
    c = client_for(request.getfixturevalue(who))
    for path in ("options/", "entries/", "exits/", "entries/export/", "exits/export/"):
        assert c.get(f"{BASE}/movements/{path}").status_code == 403, path
    # Manipular parámetros no cambia nada.
    assert (
        c.get(f"{BASE}/movements/entries/", {"page_size": 100, "status": "ACTIVE"}).status_code
        == 403
    )


# ── 6–8: Ajustes, persistencia y auditoría ────────────────────────────────────


def test_admin_grants_and_revokes_from_settings(client_for, admin, analyst, history):
    a = client_for(admin)
    granted = a.post(
        f"{BASE}/movements/permissions/{analyst.pk}/", {"entries": True}, format="json"
    )
    assert granted.status_code == 200
    assert granted.json()["entries"] == {"direct": True, "by_role": False}
    assert granted.json()["exits"] == {"direct": False, "by_role": False}
    assert client_for(analyst).get(f"{BASE}/movements/entries/").status_code == 200

    revoked = a.post(
        f"{BASE}/movements/permissions/{analyst.pk}/", {"entries": False}, format="json"
    )
    assert revoked.json()["entries"]["direct"] is False
    assert (
        client_for(analyst).get(f"{BASE}/movements/entries/").status_code == 403
    )  # efecto inmediato
    # El rol no cambió.
    assert list(User.objects.get(pk=analyst.pk).groups.values_list("name", flat=True)) == [
        "ANALISTA_CC"
    ]

    listing = a.get(f"{BASE}/movements/permissions/", {"q": "analista"}).json()
    assert [u["id"] for u in listing] == [analyst.pk]
    assert all(not u["id"] == admin.pk for u in a.get(f"{BASE}/movements/permissions/").json())


def test_permissions_persist_across_sessions(client_for, admin, hr, history):
    _grant(admin, hr, exits=True)
    # Un cliente nuevo = una sesión nueva: el permiso viene de la base.
    assert client_for(hr).get(f"{BASE}/movements/exits/").status_code == 200
    assert User.objects.get(pk=hr.pk).user_permissions.filter(codename=EXITS).exists()


def test_only_admin_manages_and_nobody_grants_themselves(client_for, admin, analyst, hr, history):
    _grant(admin, analyst, entries=True)
    c = client_for(analyst)
    assert c.get(f"{BASE}/movements/permissions/").status_code == 403
    assert (
        c.post(
            f"{BASE}/movements/permissions/{analyst.pk}/", {"exits": True}, format="json"
        ).status_code
        == 403
    )
    assert (
        c.post(
            f"{BASE}/movements/permissions/{hr.pk}/", {"entries": True}, format="json"
        ).status_code
        == 403
    )
    assert not User.objects.get(pk=hr.pk).user_permissions.exists()
    a = client_for(admin)
    assert (
        a.post(
            f"{BASE}/movements/permissions/{admin.pk}/", {"entries": True}, format="json"
        ).status_code
        == 403
    )
    bad = a.post(f"{BASE}/movements/permissions/{hr.pk}/", {"entries": "si"}, format="json")
    assert bad.status_code == 400


def test_permission_changes_are_audited(admin, analyst, history):
    _grant(admin, analyst, entries=True, exits=True)
    _grant(admin, analyst, exits=False)
    _grant(admin, analyst, exits=False)  # sin cambio: no audita
    logs = list(
        AuditLog.objects.filter(action="novedades.movements.permission_changed").order_by(
            "created_at", "id"
        )
    )
    assert [(log.previous_values, log.new_values) for log in logs] == [
        ({"tab": "Ingresos", "enabled": False}, {"tab": "Ingresos", "enabled": True}),
        ({"tab": "Salidas", "enabled": False}, {"tab": "Salidas", "enabled": True}),
        ({"tab": "Salidas", "enabled": True}, {"tab": "Salidas", "enabled": False}),
    ]
    assert all(log.actor_id == admin.pk and str(log.target_id) == str(analyst.pk) for log in logs)
    assert all(log.created_at is not None for log in logs)


# ── 9–10: datos reales, filtros, contadores y paginación ──────────────────────


def test_counters_distinguish_movements_from_people(admin, history):
    ana, beto, caro = history
    entries = MovementService.entries(admin, {})
    assert entries["counters"] == {"movements": 4, "people": 3, "altas": 3, "reingresos": 1}
    exits = MovementService.exits(admin, {})
    assert exits["counters"] == {"movements": 3, "people": 2}
    assert {r["cedula"] for r in exits["results"]} == {ana.cedula, beto.cedula}


def test_filters_reflect_persisted_records(admin, supervisor, supervisor2, history):
    ana, beto, caro = history
    by = lambda params, kind="exits": {  # noqa: E731
        r["cedula"] for r in getattr(MovementService, kind)(admin, params)["results"]
    }
    assert by({"q": "beto"}) == {beto.cedula}
    assert by({"q": "0102030405"}) == {ana.cedula}
    assert by({"cargo": "Bodeguero"}, "entries") == {beto.cedula, caro.cedula}
    # Supervisor responsable EN LA FECHA del movimiento: Beto salió siendo de
    # sup1 aunque hoy pertenezca a sup2.
    assert by({"supervisor": supervisor.pk}) == {ana.cedula, beto.cedula}
    assert by({"supervisor": supervisor2.pk}) == set()
    assert by({"supervisor": supervisor2.pk}, "entries") == {caro.cedula}
    assert by({"status": "ACTIVE"}, "entries") == {caro.cedula}
    # Rango de fechas del calendario del negocio.
    day = (NOW - timedelta(days=10) - timedelta(hours=5)).date()
    assert by({"date_from": day.isoformat(), "date_to": day.isoformat()}) == {beto.cedula}
    exit_row = next(r for r in MovementService.exits(admin, {"q": "beto"})["results"])
    assert exit_row["supervisor"] == "Sup1" and exit_row["changed_by"] == "Sup1"
    assert exit_row["status"] == "INACTIVE" and exit_row["previous_status"] == "ACTIVE"
    with pytest.raises(NovedadesError):
        MovementService.exits(admin, {"date_from": "2026-10-10", "date_to": "2026-10-01"})


def test_entry_rows_show_origin_and_registered_by(admin, supervisor, history):
    rows = MovementService.entries(admin, {"q": "ana"})["results"]
    kinds = sorted(r["kind"] for r in rows)
    assert kinds == ["ALTA", "REINGRESO"]
    alta = next(r for r in rows if r["kind"] == "ALTA")
    assert alta["origin"] == "Formulario" and alta["registered_by"] == "Sup1"
    NovedadEvent.objects.filter(
        action="collaborator.created", target_id=str(alta["collaborator_id"])
    ).update(source_file="base.xlsx")
    alta = next(
        r for r in MovementService.entries(admin, {"q": "ana"})["results"] if r["kind"] == "ALTA"
    )
    assert alta["origin"] == "Importación (base.xlsx)"


def test_pagination_never_skips_or_repeats(admin, supervisor):
    PeriodService.ensure_current(supervisor)
    for i in range(30):
        c = _collab(supervisor, f"09{i:08d}", f"Persona {i:02d}")
        if i % 3 == 0:
            CollaboratorService.change_status(access(supervisor), c.pk, "INACTIVE", "Salida")
            CollaboratorService.change_status(access(supervisor), c.pk, "ACTIVE", "Vuelve")
    for kind, total in (("entries", 40), ("exits", 10)):
        for order in ("desc", "asc"):
            seen = []
            for page in (1, 2):
                data = getattr(MovementService, kind)(
                    admin, {"page": page, "page_size": 25, "order": order}
                )
                assert data["count"] == total
                seen += [r["id"] for r in data["results"]]
            assert len(seen) == total and len(set(seen)) == total, (kind, order)


# ── 11: exportación ───────────────────────────────────────────────────────────


def _sheet(response):
    wb = openpyxl.load_workbook(io.BytesIO(response.content))
    return [[c.value for c in row] for row in wb.active.iter_rows()]


def test_export_respects_permission_and_filters(client_for, admin, analyst, history):
    ana, beto, caro = history
    _grant(admin, analyst, exits=True)
    c = client_for(analyst)
    response = c.get(f"{BASE}/movements/exits/export/", {"q": "ana"})
    assert response.status_code == 200
    rows = _sheet(response)
    assert rows[0] == MOVEMENT_EXPORT_HEADERS["exits"]
    assert [r[2] for r in rows[1:]] == [ana.cedula, ana.cedula]  # solo lo filtrado
    assert c.get(f"{BASE}/movements/entries/export/").status_code == 403
    entries = _sheet(
        client_for(admin).get(f"{BASE}/movements/entries/export/", {"cargo": "Bodeguero"})
    )
    assert entries[0] == MOVEMENT_EXPORT_HEADERS["entries"]
    assert sorted(r[2] for r in entries[1:]) == [beto.cedula, caro.cedula]
    assert AuditLog.objects.filter(
        action="novedades.movements.export_exits", actor=analyst
    ).exists()


# ── 12–14: sin efectos colaterales ────────────────────────────────────────────


def _state():
    return (
        list(
            Collaborator.objects.order_by("pk").values_list(
                "pk", "status", "updated_at", "current_supervisor"
            )
        ),
        list(
            CollaboratorStatusChange.objects.order_by("pk").values_list(
                "pk", "new_status", "created_at"
            )
        ),
        list(
            CollaboratorAssignment.objects.order_by("pk").values_list(
                "pk", "supervisor", "ended_at"
            )
        ),
    )


def test_reading_and_exporting_never_notify_nor_modify(client_for, admin, history):
    ExitNotificationRecipient.objects.create(
        email="th@example.com", created_by=admin, updated_by=admin
    )
    events, outbox, before = (
        CollaboratorExitNotification.objects.count(),
        len(mail.outbox),
        _state(),
    )
    c = client_for(admin)
    for path in ("entries/", "exits/", "entries/export/", "exits/export/", "options/"):
        assert c.get(f"{BASE}/movements/{path}").status_code == 200
    assert CollaboratorExitNotification.objects.count() == events
    assert len(mail.outbox) == outbox
    assert _state() == before


def test_other_modules_authorization_is_unchanged(client_for, admin, hr, supervisor, history):
    _grant(admin, hr, entries=True, exits=True)
    hr_fresh = User.objects.get(pk=hr.pk)
    # Solo se suman los dos permisos de consulta: ni acceso al módulo ni otros.
    assert access(hr_fresh).can("novedades.acceder") is False
    assert client_for(hr).get(f"{BASE}/me/").status_code == 403
    assert client_for(hr).get(f"{BASE}/collaborators/").status_code == 403
    direct = set(hr_fresh.user_permissions.values_list("codename", flat=True))
    assert direct == {ENTRIES, EXITS}
    # Un supervisor con el permiso conserva exactamente su ámbito del módulo.
    _grant(admin, supervisor, entries=True)
    sup_access = access(supervisor)
    assert sup_access.is_supervisor and not sup_access.national_write
    assert client_for(supervisor).get(f"{BASE}/movements/entries/").status_code == 200
    assert client_for(supervisor).get(f"{BASE}/movements/exits/").status_code == 403


def test_role_grant_is_shown_separately(admin, hr, history):
    from django.contrib.auth.models import Group

    Group.objects.get(name="ASISTENTE_GH").permissions.add(Permission.objects.get(codename=ENTRIES))
    row = next(
        u
        for u in MovementPermissionService.users(User.objects.get(pk=admin.pk))
        if u["id"] == hr.pk
    )
    assert row["entries"] == {"direct": False, "by_role": True}
    assert MovementService.can_view(User.objects.get(pk=hr.pk), "entries")


def test_cargo_filter_ignores_case_and_options_do_not_repeat(admin, supervisor, history):
    _collab(supervisor, "0102030499", "Dora Luna", "BODEGUERO")
    rows = MovementService.entries(admin, {"cargo": "bodeguero"})["results"]
    assert {r["full_name"] for r in rows} == {"Beto Ríos", "Caro Vega", "Dora Luna"}
    cargos = MovementService.options(admin)["cargos"]
    assert [c for c in cargos if c.casefold() == "bodeguero"] == ["Bodeguero"]
