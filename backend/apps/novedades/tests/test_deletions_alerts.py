"""Eliminación de registros de horas extras y de colaboradores de la base, y
alertas administrativas (roja = eliminación, azul = colaborador nuevo)."""

from datetime import date

import pytest

from apps.notifications.models import Notification
from apps.novedades.models import Collaborator, NovedadEvent, OvertimeRecord
from apps.novedades.periods import PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    CorrectionService,
    NovedadesError,
    OvertimeService,
    PeriodService,
)

from .conftest import access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
OCT = PeriodKey(2026, 10)
MON = date(2026, 10, 12)


def _collab(sup, cedula="0102030405", name="Ana Pérez"):
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(cedula=cedula, full_name=name, regional="Sierra", cargo="Operador"),
    )


def _overtime(sup, collaborator):
    return OvertimeService.create(
        access(sup), {"collaborator_id": collaborator.pk, "date": MON, "overtime_hours": "2"}
    )


def _alerts(user, category):
    return list(
        Notification.objects.filter(user=user, category=category).values_list("message", flat=True)
    )


# ── Horas extras ──────────────────────────────────────────────────────────────


def test_deleting_saved_overtime_keeps_collaborator_audits_and_sends_one_red_alert(
    client_for, admin, supervisor
):
    c = _collab(supervisor)
    record = _overtime(supervisor, c)
    client = client_for(supervisor)

    response = client.delete(
        f"{BASE}/overtime/{record.pk}/", {"reason": "Digitado por error"}, format="json"
    )
    assert response.status_code == 204
    record.refresh_from_db()
    assert record.deleted_at is not None and record.deleted_by == supervisor  # borrado lógico
    assert Collaborator.objects.filter(pk=c.pk).exists()  # el colaborador sigue en la base
    assert NovedadEvent.objects.filter(
        action="overtime.deleted", target_id=record.pk, reason="Digitado por error"
    ).exists()
    red = _alerts(admin, "deletion")
    assert len(red) == 1
    for fragment in ("Ana Pérez", "0102030405", "12/10/2026", "Sup1", "sigue en la base"):
        assert fragment in red[0]

    # Segunda ejecución (doble clic / reintento): 404 y ninguna alerta ni evento extra.
    again = client.delete(f"{BASE}/overtime/{record.pk}/", {}, format="json")
    assert again.status_code == 404
    assert len(_alerts(admin, "deletion")) == 1
    assert NovedadEvent.objects.filter(action="overtime.deleted").count() == 1


def test_overtime_delete_without_permission_or_out_of_scope_fails_without_alert(
    client_for, admin, supervisor, supervisor2, assistant
):
    record = _overtime(supervisor, _collab(supervisor))
    for user in (supervisor2, assistant):
        response = client_for(user).delete(f"{BASE}/overtime/{record.pk}/", {}, format="json")
        assert response.status_code in (403, 404)
    record.refresh_from_db()
    assert record.deleted_at is None
    assert _alerts(admin, "deletion") == []


def test_overtime_delete_in_closed_period_is_rejected_without_alert(admin, supervisor):
    record = _overtime(supervisor, _collab(supervisor))
    PeriodService.close(access(supervisor), OCT, supervisor)
    with pytest.raises(NovedadesError):
        OvertimeService.delete(access(supervisor), record.pk, "x")
    record.refresh_from_db()
    assert record.deleted_at is None
    assert _alerts(admin, "deletion") == []


def test_correction_that_deletes_closed_period_overtime_sends_red_alert(
    admin, supervisor, assistant
):
    """La alerta llega a los administradores distintos de quien elimina: aquí
    elimina el Administrador, así que se verifica con un segundo admin."""
    from .conftest import _user

    other_admin = _user("admin2", "ADMINISTRADOR", superuser=True)
    record = _overtime(supervisor, _collab(supervisor))
    PeriodService.close(access(supervisor), OCT, supervisor)
    CorrectionService.correct_overtime(
        access(admin), record_id=record.pk, changes={}, delete=True, reason="Duplicado"
    )
    red = _alerts(other_admin, "deletion")
    assert len(red) == 1 and "Duplicado" in red[0] and "sigue en la base" in red[0]
    assert _alerts(admin, "deletion") == []  # quien elimina no se alerta a sí mismo


# ── Colaboradores ─────────────────────────────────────────────────────────────


def test_new_collaborator_from_form_sends_blue_alert_and_updates_do_not(admin, supervisor):
    c = _collab(supervisor)
    blue = _alerts(admin, "new_collaborator")
    assert len(blue) == 1
    assert "Ana Pérez" in blue[0] and "origen: formulario" in blue[0] and "Sup1" in blue[0]

    CollaboratorService.update(access(supervisor), c.pk, {"cargo": "Jefe"})
    assert len(_alerts(admin, "new_collaborator")) == 1


def test_failed_collaborator_creation_sends_no_alert(admin, supervisor):
    _collab(supervisor)
    with pytest.raises(NovedadesError):
        _collab(supervisor)  # cédula duplicada
    assert len(_alerts(admin, "new_collaborator")) == 1


def test_admin_deletes_collaborator_without_history_and_red_alert_is_sent(
    client_for, admin, supervisor
):
    from .conftest import _user

    other_admin = _user("admin2", "ADMINISTRADOR", superuser=True)
    c = _collab(supervisor)
    response = client_for(admin).delete(
        f"{BASE}/collaborators/{c.pk}/", {"reason": "Registro de prueba"}, format="json"
    )
    assert response.status_code == 204
    assert not Collaborator.objects.filter(pk=c.pk).exists()
    event = NovedadEvent.objects.get(action="collaborator.deleted")
    assert event.reason == "Registro de prueba" and "0102030405" in event.old_value
    red = _alerts(other_admin, "deletion")
    assert len(red) == 1 and "eliminado de la base oficial" in red[0]
    # La alerta de eliminación de colaborador es distinta a la de horas extras.
    assert "horas extras" not in red[0]

    again = client_for(admin).delete(
        f"{BASE}/collaborators/{c.pk}/", {"reason": "x"}, format="json"
    )
    assert again.status_code == 404
    assert len(_alerts(other_admin, "deletion")) == 1


def test_collaborator_deletion_rules(client_for, admin, supervisor):
    c = _collab(supervisor)
    # Solo el Administrador.
    response = client_for(supervisor).delete(
        f"{BASE}/collaborators/{c.pk}/", {"reason": "x"}, format="json"
    )
    assert response.status_code == 403
    # Motivo obligatorio.
    with pytest.raises(NovedadesError):
        CollaboratorService.delete(access(admin), c.pk, "  ")
    # Con historia (aunque el registro esté eliminado) no se borra: se inactiva.
    record = _overtime(supervisor, c)
    OvertimeService.delete(access(supervisor), record.pk, "x")
    with pytest.raises(NovedadesError) as exc:
        CollaboratorService.delete(access(admin), c.pk, "Limpieza")
    assert exc.value.code == "has_history"
    assert Collaborator.objects.filter(pk=c.pk).exists()
    assert OvertimeRecord.objects.filter(pk=record.pk).exists()
    assert not NovedadEvent.objects.filter(action="collaborator.deleted").exists()
