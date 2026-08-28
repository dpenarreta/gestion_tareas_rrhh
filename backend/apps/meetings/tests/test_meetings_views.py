"""Cobertura HTTP de `/api/v1/meetings/` — Fase 10 (ver
docs/AUDIT_LOG.md § 2026-08-19), réplica de los 2 `route.ts` de
`src/app/api/meetings/**`."""

from datetime import datetime
from datetime import timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.meetings.models import Meeting, MeetingInvitee
from apps.users.models import User

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 8, 25, 15, 0, tzinfo=dt_timezone.utc)

_ZOOM_PATCH_TARGET = "apps.meetings.services.zoom.create_zoom_meeting"
_ZOOM_RESULT = {"zoom_meeting_id": "1", "zoom_join_url": "https://zoom.us/j/1", "zoom_password": "AB12CD"}


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


def _meeting(host, *, status=Meeting.Status.PROGRAMADA) -> Meeting:
    return Meeting.objects.create(
        title="Reunión", host=host, meeting_date=NOW, duration=30, status=status,
        zoom_meeting_id="1", zoom_join_url="https://zoom.us/j/1", zoom_password="AB12CD",
    )


# --- MeetingListCreateView.get ---------------------------------------------------


def test_list_requires_authentication():
    response = APIClient().get("/api/v1/meetings/")
    assert response.status_code == 401


def test_list_includes_meetings_where_user_is_host(coordinador_nacional):
    _meeting(coordinador_nacional)
    response = _client_for(coordinador_nacional).get("/api/v1/meetings/")
    assert response.status_code == 200
    assert len(response.data) == 1


def test_list_includes_meetings_where_user_is_invitee(coordinador_nacional, analista):
    meeting = _meeting(coordinador_nacional)
    MeetingInvitee.objects.create(meeting=meeting, user=analista)
    response = _client_for(analista).get("/api/v1/meetings/")
    assert response.status_code == 200
    assert len(response.data) == 1


def test_list_excludes_meetings_where_user_does_not_participate(coordinador_nacional, analista):
    _meeting(coordinador_nacional)
    response = _client_for(analista).get("/api/v1/meetings/")
    assert response.status_code == 200
    assert response.data == []


def test_list_orders_by_meeting_date_ascending(coordinador_nacional):
    later = Meeting.objects.create(title="Tarde", host=coordinador_nacional, meeting_date=datetime(2026, 9, 1, tzinfo=dt_timezone.utc), duration=30)
    earlier = Meeting.objects.create(title="Temprano", host=coordinador_nacional, meeting_date=datetime(2026, 8, 20, tzinfo=dt_timezone.utc), duration=30)
    response = _client_for(coordinador_nacional).get("/api/v1/meetings/")
    assert [m["id"] for m in response.data] == [earlier.id, later.id]


# --- MeetingListCreateView.post --------------------------------------------------


def test_create_403_for_role_without_permission(analista):
    response = _client_for(analista).post(
        "/api/v1/meetings/", {"title": "Sync", "meeting_date": NOW.isoformat(), "duration": 30}, format="json"
    )
    assert response.status_code == 403


def test_create_400_for_blank_title(coordinador_nacional):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/meetings/", {"title": "   ", "meeting_date": NOW.isoformat(), "duration": 30}, format="json"
    )
    assert response.status_code == 400


def test_create_400_for_zero_duration(coordinador_nacional):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/meetings/", {"title": "Sync", "meeting_date": NOW.isoformat(), "duration": 0}, format="json"
    )
    assert response.status_code == 400


def test_create_400_for_missing_meeting_date(coordinador_nacional):
    response = _client_for(coordinador_nacional).post("/api/v1/meetings/", {"title": "Sync", "duration": 30}, format="json")
    assert response.status_code == 400


def test_create_201_with_real_zoom_data(coordinador_nacional):
    with patch(_ZOOM_PATCH_TARGET, return_value=_ZOOM_RESULT):
        response = _client_for(coordinador_nacional).post(
            "/api/v1/meetings/", {"title": "Sync semanal", "meeting_date": NOW.isoformat(), "duration": 30}, format="json"
        )
    assert response.status_code == 201
    assert response.data["zoom_warning"] is None
    assert response.data["zoom_meeting_id"] == "1"
    assert response.data["host"]["id"] == coordinador_nacional.id


def test_create_201_with_simulated_zoom_link_on_failure(coordinador_nacional):
    with patch(_ZOOM_PATCH_TARGET, side_effect=Exception("boom")):
        response = _client_for(coordinador_nacional).post(
            "/api/v1/meetings/", {"title": "Sync semanal", "meeting_date": NOW.isoformat(), "duration": 30}, format="json"
        )
    assert response.status_code == 201
    assert response.data["zoom_warning"] == "No se pudo conectar con Zoom. Se generó un enlace simulado."


def test_create_includes_invitees_and_excludes_host(coordinador_nacional, analista):
    other = User.objects.create_user(username="other", email="other@example.com", password="Sup3r-Secr3t!")
    with patch(_ZOOM_PATCH_TARGET, return_value=_ZOOM_RESULT):
        response = _client_for(coordinador_nacional).post(
            "/api/v1/meetings/",
            {
                "title": "Sync semanal", "meeting_date": NOW.isoformat(), "duration": 30,
                "invitee_ids": [analista.id, other.id, coordinador_nacional.id],
            },
            format="json",
        )
    assert response.status_code == 201
    invitee_ids = {inv["user"]["id"] for inv in response.data["invitees"]}
    assert invitee_ids == {analista.id, other.id}


# --- MeetingDetailView.get --------------------------------------------------------


def test_detail_404_for_missing_meeting(coordinador_nacional):
    response = _client_for(coordinador_nacional).get("/api/v1/meetings/999999/")
    assert response.status_code == 404


def test_detail_403_for_non_participant(coordinador_nacional, analista):
    meeting = _meeting(coordinador_nacional)
    response = _client_for(analista).get(f"/api/v1/meetings/{meeting.id}/")
    assert response.status_code == 403


def test_detail_200_for_host(coordinador_nacional):
    meeting = _meeting(coordinador_nacional)
    response = _client_for(coordinador_nacional).get(f"/api/v1/meetings/{meeting.id}/")
    assert response.status_code == 200
    assert response.data["id"] == meeting.id


def test_detail_200_for_invitee(coordinador_nacional, analista):
    meeting = _meeting(coordinador_nacional)
    MeetingInvitee.objects.create(meeting=meeting, user=analista)
    response = _client_for(analista).get(f"/api/v1/meetings/{meeting.id}/")
    assert response.status_code == 200


# --- MeetingDetailView.patch -------------------------------------------------------


def test_patch_403_for_non_host(coordinador_nacional, analista):
    meeting = _meeting(coordinador_nacional)
    MeetingInvitee.objects.create(meeting=meeting, user=analista)
    response = _client_for(analista).patch(f"/api/v1/meetings/{meeting.id}/", {"title": "Nuevo"}, format="json")
    assert response.status_code == 403


def test_patch_404_for_missing_meeting(coordinador_nacional):
    response = _client_for(coordinador_nacional).patch("/api/v1/meetings/999999/", {"title": "Nuevo"}, format="json")
    assert response.status_code == 404


def test_patch_updates_only_whitelisted_fields(coordinador_nacional):
    meeting = _meeting(coordinador_nacional)
    response = _client_for(coordinador_nacional).patch(
        f"/api/v1/meetings/{meeting.id}/",
        {"status": Meeting.Status.EN_CURSO, "otter_invited": True, "zoom_password": "HACKED"},
        format="json",
    )
    assert response.status_code == 200
    meeting.refresh_from_db()
    assert meeting.status == Meeting.Status.EN_CURSO
    assert meeting.otter_invited is True
    assert meeting.zoom_password == "AB12CD"  # zoom_password no está en la whitelist -> se ignora.


def test_patch_ignores_unknown_fields(coordinador_nacional):
    meeting = _meeting(coordinador_nacional)
    response = _client_for(coordinador_nacional).patch(
        f"/api/v1/meetings/{meeting.id}/", {"host_id": 999999, "title": "Editado"}, format="json"
    )
    assert response.status_code == 200
    meeting.refresh_from_db()
    assert meeting.host_id == coordinador_nacional.id
    assert meeting.title == "Editado"


# --- MeetingDetailView.delete -------------------------------------------------------


def test_delete_403_for_non_host(coordinador_nacional, analista):
    meeting = _meeting(coordinador_nacional)
    response = _client_for(analista).delete(f"/api/v1/meetings/{meeting.id}/")
    assert response.status_code == 403


def test_delete_404_for_missing_meeting(coordinador_nacional):
    response = _client_for(coordinador_nacional).delete("/api/v1/meetings/999999/")
    assert response.status_code == 404


def test_delete_200_for_host_cascades_invitees(coordinador_nacional, analista):
    meeting = _meeting(coordinador_nacional)
    MeetingInvitee.objects.create(meeting=meeting, user=analista)
    response = _client_for(coordinador_nacional).delete(f"/api/v1/meetings/{meeting.id}/")
    assert response.status_code == 200
    assert response.data == {"ok": True}
    assert not Meeting.objects.filter(pk=meeting.id).exists()
    assert not MeetingInvitee.objects.filter(meeting_id=meeting.id).exists()
