"""Notificación de ingreso de nuevos colaboradores (pedido del 2026-10-15).

Reglas (decisiones del usuario):
- Solo las altas por formulario marcadas como "nuevo ingreso" la generan;
  importaciones, reactivaciones y colaboradores existentes nunca.
- Día válido = horas > 0 (vacío y 0 no cuentan); cada fecha cuenta una vez.
- Se envía al guardarse el SEGUNDO día válido; la tabla es la fila del
  período (23 → 22) de ese segundo día.
- Un correo por destinatario; listas de ingreso y salida independientes.
En los tests Django usa `locmem` (`mail.outbox`): nada sale a la red."""

import io
import smtplib
from datetime import date, timedelta
from decimal import Decimal

import openpyxl
import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.mail import EmailMultiAlternatives

from apps.core.models import AuditLog
from apps.novedades import access as perms
from apps.novedades.models import (
    Collaborator,
    CollaboratorEntryNotification,
    CollaboratorExitNotification,
    CollaboratorNotificationRecipient,
    NovedadEvent,
    WorkedDay,
)
from apps.novedades.periods import PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorMailService,
    CollaboratorService,
    EntryNotificationService,
    PeriodService,
    PermissionAdminService,
    WorkedDayService,
)

from .conftest import access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
OCT = PeriodKey(2026, 10)  # hoy 12/10/2026 (lunes): período 23/09 → 22/10
THU, FRI, MON = date(2026, 10, 8), date(2026, 10, 9), date(2026, 10, 12)
REAL_SEND = EmailMultiAlternatives.send


def _recipient(admin, kind, email, *, active=True):
    return CollaboratorNotificationRecipient.objects.create(
        kind=kind, email=email, is_active=active, created_by=admin, updated_by=admin
    )


def _hire(sup, cedula="0102030405", name="Ana Pérez", *, new_hire=True):
    PeriodService.ensure_current(sup)
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(
            cedula=cedula, full_name=name, regional="Sierra", cargo="Courier", is_new_hire=new_hire
        ),
    )


def _save(sup, c, day, hours):
    return WorkedDayService.save_cells(
        access(sup), OCT, sup, [{"collaborator_id": c.pk, "date": day, "hours": hours}]
    )


def _entry_mails():
    return [m for m in mail.outbox if "ingreso" in m.subject]


@pytest.fixture
def lists(admin):
    _recipient(admin, "ENTRY", "operaciones@example.com")
    _recipient(admin, "ENTRY", "talento@example.com")
    _recipient(admin, "ENTRY", "antiguo@example.com", active=False)
    _recipient(admin, "EXIT", "jefatura@example.com")
    _recipient(admin, "EXIT", "talento@example.com")  # la misma dirección en ambas listas


# ── 11.1 Activación ───────────────────────────────────────────────────────────


def test_only_the_second_valid_day_of_a_new_hire_sends(supervisor, lists):
    ana = _hire(supervisor)
    event = CollaboratorEntryNotification.objects.get(collaborator=ana)
    assert event.status == "WAITING" and _entry_mails() == []  # 1. alta sin días

    _save(supervisor, ana, THU, "8")  # 2. primer día válido
    event.refresh_from_db()
    assert event.status == "WAITING" and _entry_mails() == []

    _save(supervisor, ana, FRI, "7.5")  # 3. segundo día válido
    event.refresh_from_db()
    assert event.status == "SENT" and event.attempts == 1
    assert (event.first_day, event.second_day) == (THU, FRI)
    assert event.period.key == OCT and event.supervisor == supervisor
    mails = _entry_mails()
    assert sorted(m.to[0] for m in mails) == ["operaciones@example.com", "talento@example.com"]
    assert all(len(m.to) == 1 for m in mails)  # uno por destinatario
    assert mails[0].subject == "NEXO | Notificación de ingreso de nuevo colaborador — Ana Pérez"

    # 5–6. Editar los mismos días o agregar más no vuelve a enviar.
    _save(supervisor, ana, FRI, "6")
    _save(supervisor, ana, MON, "8")
    WorkedDayService.save_cells(
        access(supervisor),
        OCT,
        supervisor,
        [{"collaborator_id": ana.pk, "date": THU, "hours": "8", "version": 1}],
    )
    CollaboratorService.update(access(supervisor), ana.pk, {"cargo": "Supervisor de turno"})
    assert len(_entry_mails()) == 2
    assert CollaboratorEntryNotification.objects.count() == 1


def test_event_is_triggered_only_after_the_day_is_persisted(supervisor, lists, monkeypatch):
    """4. El correo se arma con lo que YA está en la base: en el momento del
    disparo, el segundo día existe persistido."""
    ana = _hire(supervisor)
    _save(supervisor, ana, THU, "8")
    seen = []
    real_check = EntryNotificationService.check

    def spy(ids):
        seen.append(WorkedDay.objects.filter(collaborator=ana, hours__gt=0).count())
        return real_check(ids)

    monkeypatch.setattr(EntryNotificationService, "check", staticmethod(spy))
    _save(supervisor, ana, FRI, "8")
    assert seen == [2]


def test_empty_and_zero_are_not_valid_days(supervisor, lists):
    ana = _hire(supervisor)
    _save(supervisor, ana, THU, "8")
    _save(supervisor, ana, FRI, "0")  # 8. cero reportado: no laboró
    _save(supervisor, ana, MON, None)  # 7. vacío
    event = CollaboratorEntryNotification.objects.get(collaborator=ana)
    assert event.status == "WAITING" and _entry_mails() == []
    _save(supervisor, ana, FRI, "4")  # el mismo día pasa a tener horas
    event.refresh_from_db()
    assert event.status == "SENT" and event.second_day == FRI


def _xlsx(rows):
    wb = openpyxl.Workbook()
    for row in rows:
        wb.active.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    return SimpleUploadedFile("dias.xlsx", buffer.getvalue())


def _import(client, rows):
    preview = client.post(
        f"{BASE}/imports/preview/",
        {"kind": "WORKED_DAYS", "period": "2026-10", "file": _xlsx(rows)},
        format="multipart",
    )
    assert preview.status_code == 201, preview.json()
    confirm = client.post(
        f"{BASE}/imports/{preview.json()['id']}/confirm/", {"strategy": "update"}, format="json"
    )
    assert confirm.status_code == 200, confirm.json()


def test_excel_import_applies_the_same_rule_and_is_idempotent(client_for, admin, supervisor, lists):
    PermissionAdminService.create_override(
        access(admin),
        user_id=supervisor.pk,
        codename=perms.IMPORTAR,
        effect="GRANT",
        reason="Carga",
    )
    ana = _hire(supervisor)
    header = ["Supervisor", "Cargo", "Cédula", "Empleado", THU, FRI]
    # 9. Por Excel: un día con horas y otro en cero → todavía no.
    _import(client_for(supervisor), [header, ["Sup1", "Courier", ana.cedula, ana.full_name, 8, 0]])
    assert _entry_mails() == []
    _import(client_for(supervisor), [header, ["Sup1", "Courier", ana.cedula, ana.full_name, 8, 6]])
    assert len(_entry_mails()) == 2
    # 10. Reimportar lo mismo no genera otro evento ni otro correo.
    _import(client_for(supervisor), [header, ["Sup1", "Courier", ana.cedula, ana.full_name, 8, 6]])
    assert len(_entry_mails()) == 2
    assert CollaboratorEntryNotification.objects.filter(collaborator=ana).count() == 1


def test_concurrent_triggers_send_once(supervisor, lists):
    """11. Dos disparos del mismo segundo día (doble guardado simultáneo): la
    transición En espera → Pendiente es condicional, solo uno envía."""
    ana = _hire(supervisor)
    _save(supervisor, ana, THU, "8")
    WorkedDay.objects.create(
        collaborator=ana,
        period=PeriodService.get_period(OCT),
        supervisor=supervisor,
        date=FRI,
        hours=Decimal("8"),
        updated_by=supervisor,
    )
    first = EntryNotificationService.check([ana.pk])
    second = EntryNotificationService.check([ana.pk])
    assert len(first) == 1 and second == []
    assert len(_entry_mails()) == 2  # 2 destinatarios, una vez cada uno


def test_existing_and_imported_collaborators_never_get_a_retroactive_mail(
    client_for, admin, supervisor, lists
):
    # 12. Colaborador histórico (sin marca de nuevo ingreso) con muchos días.
    old = _hire(supervisor, "0102030499", "Beto Antiguo", new_hire=False)
    for day, hours in ((THU, "8"), (FRI, "8"), (MON, "8")):
        _save(supervisor, old, day, hours)
    assert not CollaboratorEntryNotification.objects.filter(collaborator=old).exists()
    assert _entry_mails() == []


def test_reactivation_is_not_a_new_hire(supervisor, lists):
    # 13. Reactivar a alguien inactivo no crea un evento de ingreso.
    old = _hire(supervisor, "0102030498", "Caro Vuelve", new_hire=False)
    CollaboratorService.change_status(access(supervisor), old.pk, "INACTIVE", "Salida")
    CollaboratorService.change_status(access(supervisor), old.pk, "ACTIVE", "Regresa")
    _save(supervisor, old, THU, "8")
    _save(supervisor, old, FRI, "8")
    assert not CollaboratorEntryNotification.objects.exists()
    assert _entry_mails() == []


def test_new_hire_flag_via_api_and_default_is_false(client_for, supervisor):
    PeriodService.ensure_current(supervisor)
    c = client_for(supervisor)
    base = {"regional": "Sierra", "cargo": "Courier"}
    plain = c.post(
        f"{BASE}/collaborators/", {"cedula": "0102030401", "full_name": "Sin Marca", **base}
    )
    marked = c.post(
        f"{BASE}/collaborators/",
        {"cedula": "0102030402", "full_name": "Con Marca", "is_new_hire": True, **base},
        format="json",
    )
    assert plain.status_code == marked.status_code == 201
    assert not CollaboratorEntryNotification.objects.filter(
        collaborator_id=plain.json()["id"]
    ).exists()
    assert CollaboratorEntryNotification.objects.filter(
        collaborator_id=marked.json()["id"]
    ).exists()
    assert NovedadEvent.objects.filter(action="entry_notification.registered").count() == 1


# ── 11.2 Tabla del correo ─────────────────────────────────────────────────────


def test_mail_contains_the_full_persisted_row(supervisor, admin, lists):
    ana = _hire(supervisor)
    beto = _hire(supervisor, "0102030406", "Beto Ríos", new_hire=False)
    _save(supervisor, beto, THU, "6.25")
    # Celdas previas (fuera del plazo del supervisor): datos de partida.
    for day, hours in ((date(2026, 9, 23), None), (date(2026, 10, 7), Decimal("0"))):
        WorkedDay.objects.create(
            collaborator=ana,
            period=PeriodService.get_period(OCT),
            supervisor=supervisor,
            date=day,
            hours=hours,  # vacío explícito y cero reportado
            updated_by=supervisor,
        )
    _save(supervisor, ana, THU, "8")
    _save(supervisor, ana, FRI, "7.5")
    event = CollaboratorEntryNotification.objects.get(collaborator=ana)
    snap = event.snapshot
    html = _entry_mails()[0].alternatives[0][0]

    # 1–2, 10. Encabezados de la fila original, en orden, del período 23 → 22.
    for header in ("Supervisor", "Cargo", "Cédula", "Empleado", "Total"):
        assert f">{header}</th>" in html
    dates = [c["date"] for c in snap["columns"]]
    assert dates == [(date(2026, 9, 23) + timedelta(days=i)).isoformat() for i in range(30)]
    assert (
        snap["columns"][0]["weekday"] == "Miércoles" and snap["columns"][-1]["weekday"] == "Jueves"
    )
    assert html.index(">23</th>") < html.index(">01</th>") < html.index(">22</th>")
    # 3–4. Cada fecha con su valor; vacío y cero distintos.
    by_date = dict(zip(dates, (v["hours"] for v in snap["values"]), strict=True))
    assert by_date[THU.isoformat()] == "8" and by_date[FRI.isoformat()] == "7.5"
    assert by_date["2026-10-07"] == "0" and by_date["2026-09-23"] is None
    # 5. Total = misma regla que la matriz.
    matrix = WorkedDayService.matrix(access(supervisor), OCT, supervisor)
    row = next(r for r in matrix["rows"] if r["collaborator_id"] == ana.pk)
    assert snap["total"] == row["total_hours"] == "15.5"
    # 6. Período correcto y datos de los dos días.
    assert snap["period"]["code"] == OCT.code
    assert (snap["first_day_label"], snap["second_day_label"]) == ("08/10/2026", "09/10/2026")
    assert "Primer día laborado registrado" in html and "08/10/2026" in html
    # 7. Colaborador correcto, nada de otro.
    assert "0102030405" in html and "Ana Pérez" in html
    assert "0102030406" not in html and "Beto" not in html and "6.25" not in html
    assert "no acredita la contratación" in html


def test_second_day_in_next_period_uses_that_period(supervisor, lists):
    """Primer día en septiembre (período 23/08 → 22/09) y segundo en octubre:
    la tabla es la del período del segundo día."""
    ana = _hire(supervisor)
    sep = PeriodKey(2026, 9)
    WorkedDay.objects.create(
        collaborator=ana,
        period=PeriodService.get_period(sep),
        supervisor=supervisor,
        date=date(2026, 9, 22),
        hours=Decimal("8"),
        updated_by=supervisor,
    )
    _save(supervisor, ana, THU, "8")
    event = CollaboratorEntryNotification.objects.get(collaborator=ana)
    assert (event.first_day, event.second_day) == (date(2026, 9, 22), THU)
    assert event.period.key == OCT and event.snapshot["period"]["code"] == OCT.code


def test_dynamic_values_are_escaped(supervisor, admin):
    _recipient(admin, "ENTRY", "operaciones@example.com")
    evil = _hire(supervisor, "0999999999", "Eva <script>x</script>")
    _save(supervisor, evil, THU, "8")
    _save(supervisor, evil, FRI, "8")
    html = _entry_mails()[0].alternatives[0][0]
    assert "<script>" not in html and "&lt;script&gt;" in html


def test_building_the_mail_never_modifies_attendance(supervisor, lists):
    ana = _hire(supervisor)
    _save(supervisor, ana, THU, "8")
    before = list(
        WorkedDay.objects.order_by("pk").values_list("pk", "hours", "version", "updated_at")
    )
    WorkedDay.objects.create(
        collaborator=ana,
        period=PeriodService.get_period(OCT),
        supervisor=supervisor,
        date=FRI,
        hours=Decimal("8"),
        updated_by=supervisor,
    )
    before.append(
        WorkedDay.objects.filter(date=FRI).values_list("pk", "hours", "version", "updated_at").get()
    )
    EntryNotificationService.check([ana.pk])
    after = list(
        WorkedDay.objects.order_by("pk").values_list("pk", "hours", "version", "updated_at")
    )
    assert after == before


# ── 11.3 Listas de destinatarios independientes ───────────────────────────────


def test_lists_are_independent(client_for, admin, supervisor, lists):
    ana = _hire(supervisor)
    _save(supervisor, ana, THU, "8")
    _save(supervisor, ana, FRI, "8")
    entry_to = sorted(m.to[0] for m in _entry_mails())
    CollaboratorService.change_status(access(supervisor), ana.pk, "INACTIVE", "Salida")
    exit_to = sorted(m.to[0] for m in mail.outbox if "salida" in m.subject)
    # 8–9. Cada lista recibe solo su tipo; 7. una misma dirección en ambas.
    assert entry_to == ["operaciones@example.com", "talento@example.com"]
    assert exit_to == ["jefatura@example.com", "talento@example.com"]
    assert "antiguo@example.com" not in entry_to  # 6. desactivado


def test_admin_manages_both_lists_and_they_persist(client_for, admin):
    a = client_for(admin)
    for kind in ("ENTRY", "EXIT"):
        r = a.post(
            f"{BASE}/collaborator-notifications/recipients/",
            {"kind": kind, "email": "TalentoHumano@Example.com"},
            format="json",
        )
        assert r.status_code == 201 and r.json()["kind"] == kind
    dup = a.post(
        f"{BASE}/collaborator-notifications/recipients/",
        {"kind": "ENTRY", "email": "talentohumano@example.com"},
        format="json",
    )
    assert dup.status_code == 409  # duplicado dentro de la MISMA lista
    bad = a.post(
        f"{BASE}/collaborator-notifications/recipients/",
        {"kind": "OTRO", "email": "x@example.com"},
        format="json",
    )
    assert bad.status_code == 400
    # Otra sesión: la configuración viene de la base.
    config = client_for(admin).get(f"{BASE}/collaborator-notifications/recipients/").json()
    assert sorted((r["kind"], r["email"]) for r in config["recipients"]) == [
        ("ENTRY", "talentohumano@example.com"),
        ("EXIT", "talentohumano@example.com"),
    ]
    assert config["active_count"] == {"ENTRY": 1, "EXIT": 1}
    logs = AuditLog.objects.filter(action="novedades.notification_recipient.created")
    assert sorted(log.new_values["kind"] for log in logs) == ["ENTRY", "EXIT"]


@pytest.mark.parametrize("who", ["supervisor", "assistant", "other_user"])
def test_non_admins_cannot_touch_the_lists(client_for, request, admin, who):
    r = _recipient(admin, "ENTRY", "operaciones@example.com")
    c = client_for(request.getfixturevalue(who))
    responses = [
        c.get(f"{BASE}/collaborator-notifications/recipients/"),
        c.post(
            f"{BASE}/collaborator-notifications/recipients/",
            {"kind": "ENTRY", "email": "y@example.com"},
            format="json",
        ),
        c.patch(
            f"{BASE}/collaborator-notifications/recipients/{r.pk}/",
            {"is_active": False},
            format="json",
        ),
        c.get(f"{BASE}/collaborator-notifications/events/"),
        c.post(f"{BASE}/collaborator-notifications/events/ENTRY/1/retry/"),
    ]
    assert all(resp.status_code == 403 for resp in responses), [x.status_code for x in responses]
    r.refresh_from_db()
    assert r.is_active and CollaboratorNotificationRecipient.objects.count() == 1


def test_empty_list_is_failed_not_sent_and_retry_resolves_it(client_for, admin, supervisor):
    _recipient(admin, "EXIT", "jefatura@example.com")  # solo hay lista de salidas
    ana = _hire(supervisor)
    _save(supervisor, ana, THU, "8")
    _save(supervisor, ana, FRI, "8")
    event = CollaboratorEntryNotification.objects.get(collaborator=ana)
    assert event.status == "FAILED" and event.sent_at is None
    assert event.last_error == CollaboratorMailService.NO_RECIPIENTS
    assert _entry_mails() == []  # 10. la lista de salidas no recibe ingresos
    _recipient(admin, "ENTRY", "operaciones@example.com")
    r = client_for(admin).post(f"{BASE}/collaborator-notifications/events/ENTRY/{event.pk}/retry/")
    assert r.status_code == 200 and r.json()["status"] == "SENT"
    assert [m.to for m in _entry_mails()] == [["operaciones@example.com"]]


# ── 11.4 Errores y reintentos ─────────────────────────────────────────────────


def test_smtp_failure_keeps_the_day_and_retry_only_sends_to_pending(
    supervisor, admin, lists, monkeypatch
):
    ana = _hire(supervisor)
    _save(supervisor, ana, THU, "8")

    def flaky(self, fail_silently=False):
        if self.to == ["talento@example.com"]:
            raise smtplib.SMTPServerDisconnected("Connection unexpectedly closed")
        return REAL_SEND(self, fail_silently)

    monkeypatch.setattr(EmailMultiAlternatives, "send", flaky)
    result = _save(supervisor, ana, FRI, "8")
    assert result == {"saved": 1}  # 1. el día quedó guardado igual
    assert WorkedDay.objects.filter(collaborator=ana, date=FRI, hours=8).exists()
    event = CollaboratorEntryNotification.objects.get(collaborator=ana)
    assert event.status == "FAILED"  # 2. identificable
    state = {r["email"]: r["status"] for r in event.recipients}
    assert state == {"operaciones@example.com": "SENT", "talento@example.com": "FAILED"}
    assert "1 de 2" in event.last_error

    monkeypatch.setattr(EmailMultiAlternatives, "send", REAL_SEND)
    CollaboratorMailService.retry_pending()  # 3. reintento: solo al que faltaba
    event.refresh_from_db()
    assert event.status == "SENT" and event.attempts == 2  # 4.
    assert [m.to[0] for m in _entry_mails()] == ["operaciones@example.com", "talento@example.com"]
    CollaboratorMailService.retry_pending()
    assert len(_entry_mails()) == 2


def test_exit_notification_still_works_with_its_own_list(supervisor, admin, lists):
    # 5. La salida sigue funcionando, con su lista.
    beto = _hire(supervisor, "0102030406", "Beto Ríos", new_hire=False)
    CollaboratorService.change_status(access(supervisor), beto.pk, "INACTIVE", "Renuncia")
    exit_event = CollaboratorExitNotification.objects.get()
    assert exit_event.status == "SENT"
    assert sorted(r["email"] for r in exit_event.recipients) == [
        "jefatura@example.com",
        "talento@example.com",
    ]
    assert not CollaboratorEntryNotification.objects.exists()  # la salida no crea ingresos
    assert Collaborator.objects.get(pk=beto.pk).status == "INACTIVE"


def test_events_list_distinguishes_entry_from_exit(client_for, admin, supervisor, lists):
    ana = _hire(supervisor)
    _save(supervisor, ana, THU, "8")
    _save(supervisor, ana, FRI, "8")
    CollaboratorService.change_status(access(supervisor), ana.pk, "INACTIVE", "Salida")
    events = client_for(admin).get(f"{BASE}/collaborator-notifications/events/").json()
    kinds = sorted(e["kind"] for e in events)
    assert kinds == ["ENTRY", "EXIT"]
    entry = next(e for e in events if e["kind"] == "ENTRY")
    assert entry["first_day"] == THU.isoformat() and entry["second_day"] == FRI.isoformat()
    actions = set(NovedadEvent.objects.values_list("action", flat=True))
    assert {
        "entry_notification.registered",
        "entry_notification.triggered",
        "entry_notification.sent",
    } <= actions
    assert "exit_notification.sent" in actions


def test_retry_of_a_waiting_event_is_rejected(client_for, admin, supervisor, lists):
    ana = _hire(supervisor)
    event = CollaboratorEntryNotification.objects.get(collaborator=ana)
    r = client_for(admin).post(f"{BASE}/collaborator-notifications/events/ENTRY/{event.pk}/retry/")
    assert r.status_code == 400
    event.refresh_from_db()
    assert event.status == "WAITING" and _entry_mails() == []
