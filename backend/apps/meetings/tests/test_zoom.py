"""Cobertura de apps.meetings.zoom — Fase 10 (ver docs/AUDIT_LOG.md §
2026-08-19), réplica de src/lib/zoom.ts. Se mockea `requests.post`
(sin llamadas HTTP reales)."""

from datetime import datetime
from datetime import timezone as dt_timezone
from unittest.mock import Mock, patch

import pytest

from apps.meetings.zoom import ZoomError, create_zoom_meeting

NOW = datetime(2026, 8, 19, 10, 0, tzinfo=dt_timezone.utc)


def test_create_zoom_meeting_raises_without_credentials(settings):
    settings.ZOOM_ACCOUNT_ID = ""
    settings.ZOOM_CLIENT_ID = ""
    settings.ZOOM_CLIENT_SECRET = ""
    with pytest.raises(ZoomError, match="Credenciales de Zoom no configuradas"):
        create_zoom_meeting(topic="Sync semanal", start_time=NOW, duration=40)


def test_create_zoom_meeting_raises_when_oauth_fails(settings):
    settings.ZOOM_ACCOUNT_ID = "acc"
    settings.ZOOM_CLIENT_ID = "cid"
    settings.ZOOM_CLIENT_SECRET = "secret"
    oauth_response = Mock(ok=False, status_code=401)
    with patch("apps.meetings.zoom.requests.post", return_value=oauth_response) as mock_post:
        with pytest.raises(ZoomError, match="Zoom OAuth falló"):
            create_zoom_meeting(topic="Sync semanal", start_time=NOW, duration=40)
    mock_post.assert_called_once()


def test_create_zoom_meeting_raises_when_meeting_creation_fails(settings):
    settings.ZOOM_ACCOUNT_ID = "acc"
    settings.ZOOM_CLIENT_ID = "cid"
    settings.ZOOM_CLIENT_SECRET = "secret"
    oauth_response = Mock(ok=True, json=Mock(return_value={"access_token": "tok"}))
    meeting_response = Mock(ok=False, status_code=500)
    with patch("apps.meetings.zoom.requests.post", side_effect=[oauth_response, meeting_response]):
        with pytest.raises(ZoomError, match="Zoom API falló"):
            create_zoom_meeting(topic="Sync semanal", start_time=NOW, duration=40)


def test_create_zoom_meeting_returns_parsed_fields_on_success(settings):
    settings.ZOOM_ACCOUNT_ID = "acc"
    settings.ZOOM_CLIENT_ID = "cid"
    settings.ZOOM_CLIENT_SECRET = "secret"
    oauth_response = Mock(ok=True, json=Mock(return_value={"access_token": "tok"}))
    meeting_response = Mock(
        ok=True, json=Mock(return_value={"id": 123456789, "join_url": "https://zoom.us/j/123456789", "password": "AB12CD"})
    )
    with patch("apps.meetings.zoom.requests.post", side_effect=[oauth_response, meeting_response]) as mock_post:
        result = create_zoom_meeting(topic="Sync semanal", start_time=NOW, duration=40)
    assert result == {"zoom_meeting_id": "123456789", "zoom_join_url": "https://zoom.us/j/123456789", "zoom_password": "AB12CD"}
    # Segunda llamada (crear reunión) usa Bearer con el token obtenido en la primera.
    assert mock_post.call_args_list[1].kwargs["headers"]["Authorization"] == "Bearer tok"


def test_create_zoom_meeting_defaults_missing_password_to_empty_string(settings):
    settings.ZOOM_ACCOUNT_ID = "acc"
    settings.ZOOM_CLIENT_ID = "cid"
    settings.ZOOM_CLIENT_SECRET = "secret"
    oauth_response = Mock(ok=True, json=Mock(return_value={"access_token": "tok"}))
    meeting_response = Mock(ok=True, json=Mock(return_value={"id": 1, "join_url": "https://zoom.us/j/1"}))
    with patch("apps.meetings.zoom.requests.post", side_effect=[oauth_response, meeting_response]):
        result = create_zoom_meeting(topic="Sync semanal", start_time=NOW, duration=40)
    assert result["zoom_password"] == ""
