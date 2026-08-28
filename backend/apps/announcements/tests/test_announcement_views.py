"""Cobertura HTTP de `apps.announcements` — Fase 25 (ver docs/AUDIT_LOG.md
§ 2026-08-20), réplica de `src/app/api/announcements/route.ts` y
`[id]/route.ts`."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.users.models import User

from ..models import Announcement

pytestmark = pytest.mark.django_db


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


@pytest.fixture
def jefe_nacional():
    user = User.objects.create_user(username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    return user


def _announcement(*, author, expires_in_days=5, **overrides) -> Announcement:
    payload = dict(
        title="Comunicado", content="Contenido", author=author,
        expires_at=timezone.now() + timedelta(days=expires_in_days),
    )
    payload.update(overrides)
    return Announcement.objects.create(**payload)


# --- GET /announcements/ ----------------------------------------------------------------


def test_list_requires_authentication():
    response = APIClient().get("/api/v1/announcements/")
    assert response.status_code == 401


def test_list_excludes_expired_and_orders_pinned_first(coordinador_nacional):
    expired = _announcement(author=coordinador_nacional, expires_in_days=-1)
    old_active = _announcement(author=coordinador_nacional, expires_in_days=5, title="Vieja")
    pinned = _announcement(author=coordinador_nacional, expires_in_days=5, title="Fijado", pinned=True)

    response = _client_for(coordinador_nacional).get("/api/v1/announcements/")
    assert response.status_code == 200
    ids = [a["id"] for a in response.data]
    assert expired.id not in ids
    assert ids == [pinned.id, old_active.id]


def test_list_includes_author_name_and_role(coordinador_nacional):
    """Fase 44 del cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21):
    réplica del `include: { author: { select: { name, role } } }` de
    `route.ts` — único consumidor real es el widget de comunicados del
    Dashboard, que necesita el nombre del autor para mostrarlo."""
    _announcement(author=coordinador_nacional)
    response = _client_for(coordinador_nacional).get("/api/v1/announcements/")
    assert response.status_code == 200
    assert response.data[0]["author"] == {"name": "coord_nac", "role": "COORDINADOR_NACIONAL"}


# --- POST /announcements/ ---------------------------------------------------------------


def test_post_requires_leadership_role(analista):
    response = _client_for(analista).post(
        "/api/v1/announcements/", {"title": "T", "content": "C", "durationDays": 5}, format="json"
    )
    assert response.status_code == 403
    assert Announcement.objects.count() == 0


def test_post_requires_title_content_and_duration(coordinador_nacional):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/announcements/", {"title": "", "content": "C", "durationDays": 5}, format="json"
    )
    assert response.status_code == 400


def test_post_clamps_duration_days_to_1_30(coordinador_nacional):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/announcements/", {"title": "T", "content": "C", "durationDays": 999}, format="json"
    )
    assert response.status_code == 201
    announcement = Announcement.objects.get(pk=response.data["id"])
    delta = announcement.expires_at - timezone.now()
    assert 29 <= delta.days <= 30


def test_post_notifies_visible_users_excluding_author(coordinador_nacional, analista, jefe_nacional):
    response = _client_for(coordinador_nacional).post(
        "/api/v1/announcements/", {"title": "Aviso importante", "content": "C", "durationDays": 3}, format="json"
    )
    assert response.status_code == 201

    assert not Notification.objects.filter(user=coordinador_nacional).exists()
    assert Notification.objects.filter(user=analista).exists()
    assert not Notification.objects.filter(user=jefe_nacional).exists()
    notification = Notification.objects.get(user=analista)
    assert 'Aviso importante' in notification.message


# --- DELETE /announcements/<id>/ --------------------------------------------------------


def test_delete_requires_leadership_role(analista, coordinador_nacional):
    announcement = _announcement(author=coordinador_nacional)
    response = _client_for(analista).delete(f"/api/v1/announcements/{announcement.id}/")
    assert response.status_code == 403
    assert Announcement.objects.filter(pk=announcement.id).exists()


def test_delete_404_for_missing_announcement(coordinador_nacional):
    response = _client_for(coordinador_nacional).delete("/api/v1/announcements/999999/")
    assert response.status_code == 404


def test_delete_removes_announcement(coordinador_nacional):
    announcement = _announcement(author=coordinador_nacional)
    response = _client_for(coordinador_nacional).delete(f"/api/v1/announcements/{announcement.id}/")
    assert response.status_code == 200
    assert not Announcement.objects.filter(pk=announcement.id).exists()
