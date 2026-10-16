"""Notificaciones de salida de colaboradores (pedido del 2026-10-13).

Cuando un colaborador pasa de Activo a Inactivo se envía un correo, por el
SMTP existente de NEXO, a los destinatarios activos que el Administrador
configura en Ajustes, con el detalle de Días laborados del período. En los
tests Django usa el backend `locmem` (`mail.outbox`): nada sale a la red."""

import logging
import smtplib
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal

import pytest
from django.conf import settings
from django.core import mail
from django.core.mail import EmailMultiAlternatives

from apps.authentication.emails import send_password_reset_email
from apps.novedades.models import (
    Collaborator,
    CollaboratorExitNotification,
    CollaboratorNotificationRecipient,
    SupervisorPeriod,
    WorkedDay,
)
from apps.novedades.periods import PeriodKey
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    ExitNotificationService,
    NotificationRecipientService,
    NovedadesError,
    PeriodService,
    WorkedDayService,
)

from .conftest import NOW, access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"
OCT = PeriodKey(2026, 10)  # hoy 12/10/2026: período 23/09 → 22/10
SECRET = "pw-de-prueba-smtp-XyZ"
SMTP_USER = "buzon-prueba@example.com"


def _collab(sup, cedula="0102030405", name="Ana Pérez", cargo="Operador"):
    return CollaboratorService.create(
        access(sup),
        CollaboratorInput(cedula=cedula, full_name=name, regional="Sierra", cargo=cargo),
    )


def _day(c, sup, d, hours):
    return WorkedDay.objects.create(
        collaborator=c,
        period=PeriodService.get_period(OCT),
        supervisor=sup,
        date=d,
        hours=None if hours is None else Decimal(hours),
        updated_by=sup,
    )


def _recipient(admin, email, *, area="", active=True):
    return CollaboratorNotificationRecipient.objects.create(
        kind="EXIT", email=email, area=area, is_active=active, created_by=admin, updated_by=admin
    )


def _inactivate(client_for, user, c, reason="Renuncia voluntaria"):
    return client_for(user).post(
        f"{BASE}/collaborators/{c.pk}/status/",
        {"status": "INACTIVE", "reason": reason},
        format="json",
    )


@pytest.fixture
def team(supervisor, admin):
    """Ana (la que sale) con días variados y Beto (otro colaborador) en el mismo
    equipo: el correo de Ana nunca debe traer datos de Beto."""
    PeriodService.ensure_current(supervisor)
    ana = _collab(supervisor)
    beto = _collab(supervisor, "0102030406", "Beto Ríos", "Bodeguero")
    _day(ana, supervisor, date(2026, 9, 23), "8")
    _day(ana, supervisor, date(2026, 9, 24), "0")  # cero reportado
    _day(ana, supervisor, date(2026, 9, 25), None)  # vacío explícito
    _day(ana, supervisor, date(2026, 10, 1), "7.5")
    _day(beto, supervisor, date(2026, 9, 23), "6.25")
    _recipient(admin, "operaciones@example.com", area="OPERACIONES")
    _recipient(admin, "talento@example.com", area="TALENTO_HUMANO")
    _recipient(admin, "antiguo@example.com", area="OPERACIONES", active=False)
    return ana, beto


# ── 1–4, 7–12: evento, SMTP existente, destinatarios y tabla ─────────────────


def test_active_to_inactive_sends_one_mail_with_full_attendance(client_for, supervisor, team):
    ana, beto = team
    response = _inactivate(client_for, supervisor, ana)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INACTIVE"
    assert body["exit_notification"]["status"] == "SENT"

    # 1. Un evento persistido, ligado a la transición, con quién y cuándo.
    event = CollaboratorExitNotification.objects.get()
    assert event.collaborator == ana and event.changed_by == supervisor
    assert (event.previous_status, event.new_status) == ("ACTIVE", "INACTIVE")
    assert event.period.key == OCT
    assert event.status == "SENT" and event.attempts == 1 and event.sent_at is not None

    # 2. Construido con el envío de correo de Django/NEXO (remitente y backend
    #    configurados), como HTML con alternativa de texto; UN correo por
    #    destinatario (decisión del 2026-10-15), con su estado propio.
    assert len(mail.outbox) == 2
    msg = mail.outbox[0]
    assert isinstance(msg, EmailMultiAlternatives)
    assert msg.from_email == settings.DEFAULT_FROM_EMAIL
    assert msg.subject == "NEXO | Notificación de salida de colaborador — Ana Pérez"
    html = msg.alternatives[0][0]

    # 3–4. Solo los destinatarios ACTIVOS de la lista de SALIDAS.
    assert sorted(m.to[0] for m in mail.outbox) == [
        "operaciones@example.com",
        "talento@example.com",
    ]
    assert all(len(m.to) == 1 for m in mail.outbox)
    assert sorted((r["email"], r["status"]) for r in event.recipients) == [
        ("operaciones@example.com", "SENT"),
        ("talento@example.com", "SENT"),
    ]

    # 7–8. Encabezado: las 30 fechas del período 23/09 → 22/10, en orden, con
    #      su día de la semana real.
    snap = event.snapshot
    dates = [c["date"] for c in snap["columns"]]
    expected = [date(2026, 9, 23) + timedelta(days=i) for i in range(30)]
    assert dates == [d.isoformat() for d in expected]
    assert snap["columns"][0]["weekday"] == "Miércoles"  # 23/09/2026
    assert snap["columns"][-1]["weekday"] == "Jueves"  # 22/10/2026
    for header in ("Supervisor", "Cargo", "Cédula", "Empleado", "Total"):
        assert f">{header}</th>" in html
    assert (
        html.index(">23</th>")
        < html.index(">30</th>")
        < html.index(">01</th>")
        < html.index(">22</th>")
    )
    assert ">Mié</th>" in html and ">Jue</th>" in html

    # 9. Total = misma regla que la matriz de Días laborados.
    matrix = WorkedDayService.matrix(access(supervisor), OCT, supervisor)
    row = next(r for r in matrix["rows"] if r["collaborator_id"] == ana.pk)
    assert snap["total"] == row["total_hours"] == "15.5"

    # 10. Vacío y cero se conservan distintos.
    by_date = dict(zip(dates, (v["hours"] for v in snap["values"]), strict=True))
    assert by_date["2026-09-23"] == "8"
    assert by_date["2026-09-24"] == "0"
    assert by_date["2026-09-25"] is None
    assert by_date["2026-09-26"] is None  # sin registro

    # 11–12. Datos del colaborador correcto, nada de otro colaborador.
    assert snap["collaborator"]["cedula"] == "0102030405"
    assert snap["collaborator"]["cargo"] == "Operador"
    assert snap["supervisor"] == "Sup1"
    assert "0102030406" not in html and "Beto" not in html and "6.25" not in html
    assert "0102030405" in html and "Ana Pérez" in html


def test_snapshot_values_match_persisted_cells_exactly(supervisor, team):
    ana, _ = team
    snap = ExitNotificationService.build_snapshot_for(
        ana,
        supervisor,
        PeriodService.get_period(OCT),
        changed_by=supervisor,
        changed_at=NOW,
        previous="ACTIVE",
        new="INACTIVE",
    )
    persisted = {
        wd.date.isoformat(): (None if wd.hours is None else f"{wd.hours.normalize():f}")
        for wd in WorkedDay.objects.filter(collaborator=ana)
    }
    shown = {c["date"]: v["hours"] for c, v in zip(snap["columns"], snap["values"], strict=True)}
    for iso, value in persisted.items():
        assert shown[iso] == value
    assert all(shown[iso] is None for iso in shown if iso not in persisted)


# ── 13, 16 y otras transiciones: sin eventos duplicados ni falsos ─────────────


def test_repeating_the_request_does_not_send_twice(client_for, supervisor, team):
    ana, _ = team
    _inactivate(client_for, supervisor, ana)
    again = _inactivate(client_for, supervisor, ana)  # ya Inactivo: sin cambio
    assert again.status_code == 200 and "exit_notification" not in again.json()
    event = CollaboratorExitNotification.objects.get()
    ExitNotificationService.deliver(event.pk)  # reintento de algo ya enviado
    ExitNotificationService.retry_pending()
    assert CollaboratorExitNotification.objects.count() == 1
    assert len(mail.outbox) == 2  # uno por destinatario activo, ninguno repetido
    event.refresh_from_db()
    assert event.attempts == 1


@pytest.mark.parametrize(
    "start, target",
    [
        ("SUSPENDED", "INACTIVE"),
        ("SUSPENDED", "ACTIVE"),
        ("INACTIVE", "ACTIVE"),
        ("INACTIVE", "SUSPENDED"),
    ],
)
def test_other_transitions_do_not_notify(supervisor, team, start, target):
    """Solo Activo → Inactivo y Activo → Suspendido notifican (2026-10-16)."""
    ana, _ = team
    Collaborator.objects.filter(pk=ana.pk).update(status=start)  # punto de partida
    CollaboratorService.change_status(access(supervisor), ana.pk, target, "Motivo")
    assert Collaborator.objects.get(pk=ana.pk).status == target
    assert not CollaboratorExitNotification.objects.exists()
    assert mail.outbox == []


# ── Activo → Suspendido (2026-10-16): misma lista, contenido propio ───────────


def test_suspension_sends_its_own_mail_to_the_status_change_list(client_for, supervisor, team):
    ana, _ = team
    response = client_for(supervisor).post(
        f"{BASE}/collaborators/{ana.pk}/status/",
        {"status": "SUSPENDED", "reason": "Permiso sin goce"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["exit_notification"]["status"] == "SENT"
    event = CollaboratorExitNotification.objects.get()
    assert (event.previous_status, event.new_status) == ("ACTIVE", "SUSPENDED")
    assert sorted(m.to[0] for m in mail.outbox) == [
        "operaciones@example.com",
        "talento@example.com",
    ]
    msg = mail.outbox[0]
    assert msg.subject == "NEXO | Notificación de suspensión de colaborador — Ana Pérez"
    html = msg.alternatives[0][0]
    assert "Notificación de suspensión de colaborador" in html
    assert "Suspendido" in html and "no indica su motivo" in html
    assert "Permiso sin goce" not in html  # el motivo nunca va en el correo
    assert "terminación laboral" not in html  # no es el texto de la salida
    # Misma tabla de Días laborados que la salida.
    assert event.snapshot["total"] == "15.5" and len(event.snapshot["columns"]) == 30


def test_inactive_and_suspended_mails_are_different(supervisor, team):
    ana, beto = team
    CollaboratorService.change_status(access(supervisor), ana.pk, "INACTIVE", "Salida")
    CollaboratorService.change_status(access(supervisor), beto.pk, "SUSPENDED", "Revisión")
    subjects = {m.subject for m in mail.outbox}
    assert subjects == {
        "NEXO | Notificación de salida de colaborador — Ana Pérez",
        "NEXO | Notificación de suspensión de colaborador — Beto Ríos",
    }


def test_suspension_same_status_failure_and_retry(client_for, admin, supervisor, team, monkeypatch):
    ana, _ = team
    _smtp_down(monkeypatch)
    CollaboratorService.change_status(access(supervisor), ana.pk, "SUSPENDED", "Revisión")
    assert Collaborator.objects.get(pk=ana.pk).status == "SUSPENDED"  # el cambio se conserva
    event = CollaboratorExitNotification.objects.get()
    assert event.status == "FAILED"
    # Guardar el mismo estado otra vez no crea otro evento.
    CollaboratorService.change_status(access(supervisor), ana.pk, "SUSPENDED", "Revisión")
    assert CollaboratorExitNotification.objects.count() == 1
    monkeypatch.setattr(EmailMultiAlternatives, "send", REAL_SEND)
    result = client_for(admin).post(
        f"{BASE}/collaborator-notifications/events/EXIT/{event.pk}/retry/"
    )
    assert result.json()["status"] == "SENT" and len(mail.outbox) == 2
    ExitNotificationService.retry_pending()
    assert len(mail.outbox) == 2  # sin duplicados


def test_editing_other_fields_does_not_notify(supervisor, team):
    ana, _ = team
    CollaboratorService.update(access(supervisor), ana.pk, {"cargo": "Supervisor de turno"})
    assert not CollaboratorExitNotification.objects.exists()
    assert mail.outbox == []


def test_failed_status_change_produces_no_notification(client_for, supervisor, supervisor2, team):
    ana, _ = team
    # Sin motivo: el backend lo rechaza.
    response = client_for(supervisor).post(
        f"{BASE}/collaborators/{ana.pk}/status/",
        {"status": "INACTIVE", "reason": ""},
        format="json",
    )
    assert response.status_code == 400
    # Otro supervisor no puede cambiar a un colaborador ajeno.
    assert _inactivate(client_for, supervisor2, ana).status_code in (403, 404)
    ana.refresh_from_db()
    assert ana.status == "ACTIVE"
    assert not CollaboratorExitNotification.objects.exists()
    assert mail.outbox == []


# ── 14–15: fallas SMTP, reintentos sin duplicar ───────────────────────────────


REAL_SEND = EmailMultiAlternatives.send


def _smtp_down(monkeypatch):
    def boom(self, fail_silently=False):
        raise smtplib.SMTPServerDisconnected("Connection unexpectedly closed")

    monkeypatch.setattr(EmailMultiAlternatives, "send", boom)


def test_smtp_error_keeps_status_change_and_leaves_event_failed(
    client_for, supervisor, team, monkeypatch
):
    ana, _ = team
    _smtp_down(monkeypatch)
    response = _inactivate(client_for, supervisor, ana)
    assert response.status_code == 200  # el cambio de estado NO falla
    assert response.json()["exit_notification"]["status"] == "FAILED"
    ana.refresh_from_db()
    assert ana.status == "INACTIVE"
    event = CollaboratorExitNotification.objects.get()
    assert event.status == "FAILED" and event.attempts == 1 and event.sent_at is None
    assert "SMTPServerDisconnected" in event.last_error


def test_retry_after_failure_sends_once_and_never_resends(
    client_for, admin, supervisor, team, monkeypatch
):
    ana, _ = team
    _smtp_down(monkeypatch)
    _inactivate(client_for, supervisor, ana)
    event = CollaboratorExitNotification.objects.get()
    monkeypatch.setattr(EmailMultiAlternatives, "send", REAL_SEND)  # el servidor vuelve

    result = client_for(admin).post(
        f"{BASE}/collaborator-notifications/events/EXIT/{event.pk}/retry/"
    )
    assert result.status_code == 200 and result.json()["status"] == "SENT"
    assert result.json()["attempts"] == 2
    assert len(mail.outbox) == 2  # uno por destinatario

    again = client_for(admin).post(
        f"{BASE}/collaborator-notifications/events/EXIT/{event.pk}/retry/"
    )
    assert again.status_code == 409
    ExitNotificationService.retry_pending()
    assert len(mail.outbox) == 2  # sin reenvíos
    assert CollaboratorExitNotification.objects.count() == 1


def test_scheduled_retry_picks_failed_and_stale_events(supervisor, team, admin, monkeypatch):
    ana, beto = team
    CollaboratorNotificationRecipient.objects.update(is_active=False)
    CollaboratorService.change_status(access(supervisor), ana.pk, "INACTIVE", "Salida")
    event = CollaboratorExitNotification.objects.get()
    assert event.status == "FAILED"
    assert event.last_error == ExitNotificationService.NO_RECIPIENTS  # sin destinatarios
    assert mail.outbox == []

    _recipient(admin, "jefatura@example.com", area="JEFATURA_OPERACIONES")
    # Un "Enviando" de hace rato también se retoma: el proceso murió ANTES de
    # entregar el mensaje al servidor (aquí, el envío nunca llega a correr).
    monkeypatch.setattr(ExitNotificationService, "schedule", staticmethod(lambda pk: None))
    CollaboratorService.change_status(access(supervisor), beto.pk, "INACTIVE", "Salida")
    stuck = CollaboratorExitNotification.objects.get(collaborator=beto)
    CollaboratorExitNotification.objects.filter(pk=stuck.pk).update(
        status="SENDING", last_attempt_at=NOW - timedelta(hours=1)
    )
    assert ExitNotificationService.retry_pending() == {"sent": 2, "failed": 0}
    assert len(mail.outbox) == 2
    assert all(m.to == ["jefatura@example.com"] for m in mail.outbox)


# ── 17: credenciales nunca expuestas ──────────────────────────────────────────


def test_credentials_never_reach_api_or_logs(
    client_for, admin, supervisor, team, monkeypatch, settings, caplog
):
    settings.EMAIL_HOST_PASSWORD = SECRET
    settings.EMAIL_HOST_USER = SMTP_USER
    ana, _ = team

    def auth_error(self, fail_silently=False):
        raise smtplib.SMTPAuthenticationError(
            535, f"auth failed for {SMTP_USER} / {SECRET}".encode()
        )

    monkeypatch.setattr(EmailMultiAlternatives, "send", auth_error)
    caplog.set_level(logging.DEBUG)
    status_response = _inactivate(client_for, supervisor, ana)
    event = CollaboratorExitNotification.objects.get()
    assert "SMTPAuthenticationError" in event.last_error
    assert SECRET not in event.last_error and SMTP_USER not in event.last_error

    admin_client = client_for(admin)
    payloads = [
        status_response.content,
        admin_client.get(f"{BASE}/collaborator-notifications/events/").content,
        admin_client.get(f"{BASE}/collaborator-notifications/recipients/").content,
        admin_client.post(
            f"{BASE}/collaborator-notifications/events/EXIT/{event.pk}/retry/"
        ).content,
    ]
    for payload in payloads:
        assert SECRET.encode() not in payload and SMTP_USER.encode() not in payload
    assert SECRET not in caplog.text and SMTP_USER not in caplog.text


# ── 18–19: no modifica datos; período cerrado ─────────────────────────────────


def test_building_and_sending_never_touches_attendance(client_for, supervisor, team):
    ana, _ = team

    def state():
        return list(
            WorkedDay.objects.order_by("pk").values_list(
                "pk", "hours", "version", "updated_at", "updated_by"
            )
        )

    before = state()
    _inactivate(client_for, supervisor, ana)
    ExitNotificationService.render(CollaboratorExitNotification.objects.get().snapshot)
    assert state() == before


def test_closed_period_detail_is_read_from_persisted_data(supervisor, team, admin):
    ana, _ = team
    sp = PeriodService.supervisor_period(OCT, supervisor)
    SupervisorPeriod.objects.filter(pk=sp.pk).update(
        status=SupervisorPeriod.Status.CLOSED, closed_at=NOW, closed_by=supervisor
    )
    snap = ExitNotificationService.build_snapshot_for(
        ana,
        supervisor,
        PeriodService.get_period(OCT),
        changed_by=supervisor,
        changed_at=NOW,
        previous="ACTIVE",
        new="INACTIVE",
    )
    assert snap["total"] == "15.5" and snap["period"]["label"] == OCT.label
    # El evento de un período ya cerrado se reenvía igual (reintento).
    CollaboratorService.change_status(access(admin), ana.pk, "INACTIVE", "Salida")
    event = CollaboratorExitNotification.objects.get()
    assert event.status == "SENT"
    assert SupervisorPeriod.objects.get(pk=sp.pk).status == SupervisorPeriod.Status.CLOSED


# ── Contenido seguro ──────────────────────────────────────────────────────────


def test_dynamic_values_are_escaped_and_subject_has_no_newlines(supervisor, admin):
    PeriodService.ensure_current(supervisor)
    evil = _collab(supervisor, "0999999999", "Eva <script>x</script>\nBcc: a@b.c", "<b>Cargo</b>")
    _recipient(admin, "operaciones@example.com")
    CollaboratorService.change_status(access(supervisor), evil.pk, "INACTIVE", "Salida")
    msg = mail.outbox[0]
    html = msg.alternatives[0][0]
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "<b>Cargo</b>" not in html
    assert "\n" not in msg.subject and "\r" not in msg.subject
    assert msg.to == ["operaciones@example.com"]


# ── 5–6: configuración de destinatarios solo para el Administrador ────────────


def test_admin_manages_recipients_with_validation(client_for, admin):
    c = client_for(admin)
    created = c.post(
        f"{BASE}/collaborator-notifications/recipients/",
        {"kind": "EXIT", "email": "  Talento.Humano@Example.COM ", "area": "TALENTO_HUMANO"},
        format="json",
    )
    assert created.status_code == 201
    rid = created.json()["id"]
    assert created.json()["email"] == "talento.humano@example.com"

    dup = c.post(
        f"{BASE}/collaborator-notifications/recipients/",
        {"kind": "EXIT", "email": "TALENTO.HUMANO@example.com"},
        format="json",
    )
    assert dup.status_code == 409
    bad = c.post(
        f"{BASE}/collaborator-notifications/recipients/",
        {"kind": "EXIT", "email": "no-es-correo"},
        format="json",
    )
    assert bad.status_code == 400
    bad_area = c.post(
        f"{BASE}/collaborator-notifications/recipients/",
        {"kind": "EXIT", "email": "x@example.com", "area": "OTRA"},
        format="json",
    )
    assert bad_area.status_code == 400

    edited = c.patch(
        f"{BASE}/collaborator-notifications/recipients/{rid}/",
        {"email": "th@example.com", "is_active": False},
        format="json",
    )
    assert edited.status_code == 200
    assert (edited.json()["email"], edited.json()["is_active"]) == ("th@example.com", False)

    config = c.get(f"{BASE}/collaborator-notifications/recipients/").json()
    assert config["active_count"] == {"ENTRY": 0, "EXIT": 0}  # desactivado, sigue registrado
    assert [r["email"] for r in config["recipients"]] == ["th@example.com"]
    assert config["delivery"] in {"smtp", "console", "other"}
    assert CollaboratorNotificationRecipient.objects.filter(pk=rid).exists()  # nunca se borra
    assert NotificationRecipientService.active_emails("EXIT") == []


@pytest.mark.parametrize("who", ["supervisor", "assistant", "other_user", "jefe_nacional"])
def test_non_admins_cannot_read_or_change_configuration(client_for, request, admin, who):
    if who == "jefe_nacional":
        from .conftest import _user

        user = _user("jn", "JEFE_NACIONAL")
    else:
        user = request.getfixturevalue(who)
    r = _recipient(admin, "operaciones@example.com")
    c = client_for(user)
    responses = [
        c.get(f"{BASE}/collaborator-notifications/recipients/"),
        c.post(
            f"{BASE}/collaborator-notifications/recipients/",
            {"kind": "EXIT", "email": "y@example.com"},
            format="json",
        ),
        c.patch(
            f"{BASE}/collaborator-notifications/recipients/{r.pk}/",
            {"is_active": False},
            format="json",
        ),
        c.get(f"{BASE}/collaborator-notifications/events/"),
        c.post(f"{BASE}/collaborator-notifications/events/EXIT/1/retry/"),
    ]
    assert all(resp.status_code == 403 for resp in responses), [x.status_code for x in responses]
    r.refresh_from_db()
    assert r.is_active and CollaboratorNotificationRecipient.objects.count() == 1


def test_service_rejects_non_admin_even_without_the_view(supervisor):
    with pytest.raises(NovedadesError) as exc:
        NotificationRecipientService.create(
            access(supervisor), {"kind": "EXIT", "email": "z@example.com"}
        )
    assert exc.value.status == 403


# ── 20: los correos que ya existían siguen funcionando ────────────────────────


def test_existing_password_reset_mail_still_works(admin):
    send_password_reset_email(user=admin, raw_token="token-de-prueba")
    assert len(mail.outbox) == 1
    assert "Recuperación de contraseña" in mail.outbox[0].subject
    assert mail.outbox[0].to == [admin.email]


def test_snapshot_survives_later_changes_to_attendance(client_for, supervisor, team):
    """Lo notificado queda fotografiado: si después se corrige la asistencia,
    el registro del evento sigue mostrando lo que se envió."""
    ana, _ = team
    _inactivate(client_for, supervisor, ana)
    WorkedDay.objects.filter(collaborator=ana, date=date(2026, 9, 23)).update(hours=Decimal("4"))
    event = CollaboratorExitNotification.objects.get()
    assert event.snapshot["total"] == "15.5"
    assert Collaborator.objects.get(pk=ana.pk).status == "INACTIVE"
    assert event.changed_at == event.status_change.created_at
    assert isinstance(event.changed_at, datetime) and event.changed_at.tzinfo == dt_timezone.utc
