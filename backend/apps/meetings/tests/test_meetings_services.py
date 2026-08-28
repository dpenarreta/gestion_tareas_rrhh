"""Cobertura de apps.meetings.services.create_meeting — Fase 10 (ver
docs/AUDIT_LOG.md § 2026-08-19), réplica del handler `POST
/api/meetings` (`route.ts`)."""

from datetime import datetime
from datetime import timezone as dt_timezone
from unittest.mock import patch

import pytest

from apps.meetings.models import MeetingInvitee
from apps.meetings.services import create_meeting
from apps.meetings.zoom import ZoomError
from apps.notifications.models import Notification
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 25, 15, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def host():
    return User.objects.create_user(username="host", email="host@example.com", password="Sup3r-Secr3t!")


@pytest.fixture
def invitee():
    return User.objects.create_user(username="invitee", email="invitee@example.com", password="Sup3r-Secr3t!")


def test_create_meeting_uses_real_zoom_data_on_success(host):
    with patch(
        "apps.meetings.services.zoom.create_zoom_meeting",
        return_value={"zoom_meeting_id": "999", "zoom_join_url": "https://zoom.us/j/999", "zoom_password": "REAL01"},
    ) as mock_create:
        meeting, zoom_warning = create_meeting(
            host=host, title="Sync semanal", description=None, meeting_date=NOW, duration=30, invitee_ids=[]
        )
    assert zoom_warning is None
    assert meeting.zoom_meeting_id == "999"
    assert meeting.zoom_join_url == "https://zoom.us/j/999"
    assert meeting.zoom_password == "REAL01"
    # La duración enviada a Zoom es fija (40), no la duración real de la reunión (30).
    mock_create.assert_called_once_with(topic="Sync semanal", start_time=NOW, duration=40)


def test_create_meeting_falls_back_to_simulated_link_when_zoom_fails(host):
    with patch("apps.meetings.services.zoom.create_zoom_meeting", side_effect=ZoomError("Zoom OAuth falló (HTTP 401)")):
        meeting, zoom_warning = create_meeting(
            host=host, title="Sync semanal", description=None, meeting_date=NOW, duration=30, invitee_ids=[]
        )
    assert zoom_warning == "No se pudo conectar con Zoom. Se generó un enlace simulado."
    assert meeting.zoom_meeting_id.isdigit()
    assert meeting.zoom_join_url == f"https://zoom.us/j/{meeting.zoom_meeting_id}"
    assert len(meeting.zoom_password) == 6


def test_create_meeting_excludes_host_from_invitees(host, invitee):
    with patch(
        "apps.meetings.services.zoom.create_zoom_meeting",
        return_value={"zoom_meeting_id": "1", "zoom_join_url": "u", "zoom_password": "p"},
    ):
        meeting, _ = create_meeting(
            host=host, title="Sync", description=None, meeting_date=NOW, duration=30,
            invitee_ids=[host.id, invitee.id],
        )
    invitee_user_ids = set(MeetingInvitee.objects.filter(meeting=meeting).values_list("user_id", flat=True))
    assert invitee_user_ids == {invitee.id}


def test_create_meeting_notifies_invitees_reusing_task_title_field(host, invitee):
    with patch(
        "apps.meetings.services.zoom.create_zoom_meeting",
        return_value={"zoom_meeting_id": "1", "zoom_join_url": "u", "zoom_password": "p"},
    ):
        meeting, _ = create_meeting(
            host=host, title="Retro de sprint", description=None, meeting_date=NOW, duration=30, invitee_ids=[invitee.id]
        )
    notification = Notification.objects.get(user=invitee)
    assert notification.message == 'Te invitaron a la reunión "Retro de sprint"'
    assert notification.task_title == "Retro de sprint"
    assert notification.task_id is None


def test_create_meeting_without_invitees_sends_no_notifications(host):
    with patch(
        "apps.meetings.services.zoom.create_zoom_meeting",
        return_value={"zoom_meeting_id": "1", "zoom_join_url": "u", "zoom_password": "p"},
    ):
        create_meeting(host=host, title="Solo", description=None, meeting_date=NOW, duration=30, invitee_ids=[])
    assert Notification.objects.count() == 0


def test_create_meeting_blanks_description_when_none(host):
    with patch(
        "apps.meetings.services.zoom.create_zoom_meeting",
        return_value={"zoom_meeting_id": "1", "zoom_join_url": "u", "zoom_password": "p"},
    ):
        meeting, _ = create_meeting(host=host, title="Sync", description="", meeting_date=NOW, duration=30, invitee_ids=[])
    assert meeting.description is None
